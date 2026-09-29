// "말씀 읽고 새 인생" 서버 (Cloudflare Worker)
// - /api/* : 앱 데이터 API
// - 그 외   : public/ 폴더의 앱 화면
// - 5분마다 : 알림 발송 (wrangler.toml 의 crons)
import {
  formatChapters, kstTime, kstToday, parseChapters, validChapters,
} from "../public/shared/bible.js";
import { buildMessage, dueSlots, progress, SLOTS } from "./logic.js";
import { b64urlEncode, sendPush } from "./push.js";

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const nowIso = () => new Date().toISOString();
const TIME_RE = /^([01]\d|2[0-3]):[0-5][05]$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      return await handleApi(request, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "서버에 문제가 생겼어요. 잠시 후 다시 해 주세요." }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotifications(env, event.scheduledTime || Date.now()));
  },
};

// ── DB 읽기 도우미 ─────────────────────────────────────
async function loadPlan(env) {
  const { results } = await env.DB.prepare("SELECT day, chapters FROM plan_days ORDER BY day").all();
  return results.map((r) => ({ day: r.day, chapters: JSON.parse(r.chapters) }));
}

async function getSetting(env, key) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  return row ? row.value : null;
}

// Map<memberId, Map<day, Set<chapterKey>>>
async function loadChecks(env, memberId = null) {
  const stmt = memberId === null
    ? env.DB.prepare("SELECT member_id, day, chapter FROM checks")
    : env.DB.prepare("SELECT member_id, day, chapter FROM checks WHERE member_id = ?").bind(memberId);
  const { results } = await stmt.all();
  const byMember = new Map();
  for (const r of results) {
    if (!byMember.has(r.member_id)) byMember.set(r.member_id, new Map());
    const days = byMember.get(r.member_id);
    if (!days.has(r.day)) days.set(r.day, new Set());
    days.get(r.day).add(r.chapter);
  }
  return byMember;
}

async function authMember(request, env) {
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/, "");
  if (!token) throw new HttpError(401, "다시 입장해 주세요.");
  const me = await env.DB.prepare("SELECT * FROM members WHERE token = ?").bind(token).first();
  if (!me) throw new HttpError(401, "다시 입장해 주세요.");
  await env.DB.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?").bind(nowIso(), me.id).run();
  return me;
}

const publicMember = (m) => ({
  id: m.id, name: m.name,
  morning: m.morning, lunch: m.lunch, evening: m.evening,
  morning_on: !!m.morning_on, lunch_on: !!m.lunch_on, evening_on: !!m.evening_on,
});

async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, "요청 내용을 읽지 못했어요."); }
}

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (!n || n.length > 20) throw new HttpError(400, "이름은 1–20자로 적어 주세요.");
  return n;
}

// ── API ────────────────────────────────────────────────
async function handleApi(request, env, url) {
  const path = url.pathname.slice(4); // "/api" 제거
  const method = request.method;

  // 입장 (초대 코드 + 이름). 같은 이름이 있으면 그 사람으로 이어서 사용
  if (path === "/join" && method === "POST") {
    const { name, invite } = await readBody(request);
    if (!env.INVITE_CODE || String(invite || "").trim() !== env.INVITE_CODE) {
      throw new HttpError(403, "초대 코드가 맞지 않아요.");
    }
    const n = cleanName(name);
    let me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
    if (!me) {
      const token = b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));
      await env.DB.prepare("INSERT INTO members (name, token, created_at) VALUES (?, ?, ?)")
        .bind(n, token, nowIso()).run();
      me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
    }
    return json({ token: me.token, member: publicMember(me) });
  }

  const me = await authMember(request, env);

  if (path === "/state" && method === "GET") {
    const [plan, startDate, checks] = await Promise.all([
      loadPlan(env), getSetting(env, "start_date"), loadChecks(env, me.id),
    ]);
    const mine = {};
    for (const [day, set] of checks.get(me.id) || []) mine[day] = [...set];
    return json({
      me: publicMember(me), plan, startDate, today: kstToday(), checks: mine,
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    });
  }

  if (path === "/check" && method === "POST") {
    const { day, chapter, checked } = await readBody(request);
    if (!Number.isInteger(day) || typeof chapter !== "string" || chapter.length > 40) {
      throw new HttpError(400, "잘못된 체크 요청이에요.");
    }
    if (checked) {
      await env.DB.prepare("INSERT OR IGNORE INTO checks (member_id, day, chapter, checked_at) VALUES (?, ?, ?, ?)")
        .bind(me.id, day, chapter, nowIso()).run();
    } else {
      await env.DB.prepare("DELETE FROM checks WHERE member_id = ? AND day = ? AND chapter = ?")
        .bind(me.id, day, chapter).run();
    }
    return json({ ok: true });
  }

  // 함께 읽기: 모든 사람의 진행 현황
  if (path === "/members" && method === "GET") {
    const [plan, startDate, checks, { results: members }] = await Promise.all([
      loadPlan(env), getSetting(env, "start_date"), loadChecks(env),
      env.DB.prepare("SELECT id, name, last_seen_at FROM members ORDER BY name").all(),
    ]);
    const today = kstToday();
    return json({
      members: members.map((m) => {
        const p = progress(plan, startDate, today, checks.get(m.id) || new Map());
        return {
          id: m.id, name: m.name, lastSeenAt: m.last_seen_at,
          doneDays: p.doneDays, total: p.total, missedDays: p.missed.length,
          todayDone: p.todayDone,
          todayChecked: p.todayChapters.length - p.todayRemaining.length,
          todayTotal: p.todayChapters.length,
        };
      }),
    });
  }

  // 하루 범위 수정
  const dayMatch = path.match(/^\/plan\/day\/(\d+)$/);
  if (dayMatch && method === "PUT") {
    const day = Number(dayMatch[1]);
    const { text } = await readBody(request);
    const parsed = parseChapters(text);
    if (parsed.error) throw new HttpError(400, parsed.error);
    const row = await env.DB.prepare("SELECT chapters FROM plan_days WHERE day = ?").bind(day).first();
    if (!row) throw new HttpError(404, `DAY ${day}가 없어요.`);
    const after = JSON.stringify(parsed.chapters);
    if (after === row.chapters) return json({ ok: true, unchanged: true });
    await env.DB.batch([
      env.DB.prepare("UPDATE plan_days SET chapters = ? WHERE day = ?").bind(after, day),
      historyStmt(env, "day", day, row.chapters, after, me.name),
    ]);
    return json({ ok: true, chapters: parsed.chapters });
  }

  // 전체 읽기표 직접 편집 (한 줄에 하루: "DAY 1: 누가복음 1–3장")
  if (path === "/plan/bulk" && method === "PUT") {
    const { text } = await readBody(request);
    const plan = parseBulk(text);
    const before = JSON.stringify(await loadPlan(env));
    const after = JSON.stringify(plan);
    if (before === after) return json({ ok: true, unchanged: true });
    await replacePlan(env, plan, [historyStmt(env, "bulk", null, before, after, me.name)]);
    return json({ ok: true, days: plan.length });
  }

  if (path === "/history" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, kind, day, before_value, after_value, member_name, note, created_at FROM history ORDER BY id DESC LIMIT 100",
    ).all();
    return json({ history: results.map(describeHistory) });
  }

  const revertMatch = path.match(/^\/history\/(\d+)\/revert$/);
  if (revertMatch && method === "POST") {
    const h = await env.DB.prepare("SELECT * FROM history WHERE id = ?").bind(Number(revertMatch[1])).first();
    if (!h) throw new HttpError(404, "변경 기록을 찾지 못했어요.");
    const note = `#${h.id} 되돌리기`;
    if (h.kind === "day") {
      const row = await env.DB.prepare("SELECT chapters FROM plan_days WHERE day = ?").bind(h.day).first();
      if (!row) throw new HttpError(409, `DAY ${h.day}가 지금 읽기표에 없어요.`);
      await env.DB.batch([
        env.DB.prepare("UPDATE plan_days SET chapters = ? WHERE day = ?").bind(h.before_value, h.day),
        historyStmt(env, "day", h.day, row.chapters, h.before_value, me.name, note),
      ]);
    } else if (h.kind === "bulk") {
      const current = JSON.stringify(await loadPlan(env));
      await replacePlan(env, JSON.parse(h.before_value), [
        historyStmt(env, "bulk", null, current, h.before_value, me.name, note),
      ]);
    } else if (h.kind === "start_date") {
      const current = await getSetting(env, "start_date");
      await env.DB.batch([
        setSettingStmt(env, "start_date", h.before_value),
        historyStmt(env, "start_date", null, current, h.before_value, me.name, note),
      ]);
    }
    return json({ ok: true });
  }

  // 공통 시작일 변경
  if (path === "/settings" && method === "PUT") {
    const { start_date } = await readBody(request);
    if (!DATE_RE.test(start_date || "") || Number.isNaN(Date.parse(start_date))) {
      throw new HttpError(400, "날짜 형식이 올바르지 않아요.");
    }
    const current = await getSetting(env, "start_date");
    if (current === start_date) return json({ ok: true, unchanged: true });
    await env.DB.batch([
      setSettingStmt(env, "start_date", start_date),
      historyStmt(env, "start_date", null, current, start_date, me.name),
    ]);
    return json({ ok: true });
  }

  // 내 이름·알림 시간 변경
  if (path === "/me" && method === "PUT") {
    const body = await readBody(request);
    const next = { ...me };
    if (body.name !== undefined) next.name = cleanName(body.name);
    for (const slot of SLOTS) {
      if (body[slot] !== undefined) {
        if (!TIME_RE.test(body[slot])) throw new HttpError(400, "알림 시간은 5분 단위로 정해 주세요.");
        next[slot] = body[slot];
      }
      if (body[`${slot}_on`] !== undefined) next[`${slot}_on`] = body[`${slot}_on`] ? 1 : 0;
    }
    if (next.name !== me.name) {
      const dup = await env.DB.prepare("SELECT id FROM members WHERE name = ? AND id != ?").bind(next.name, me.id).first();
      if (dup) throw new HttpError(409, "이미 있는 이름이에요.");
    }
    await env.DB.prepare(
      `UPDATE members SET name = ?, morning = ?, lunch = ?, evening = ?,
       morning_on = ?, lunch_on = ?, evening_on = ? WHERE id = ?`,
    ).bind(next.name, next.morning, next.lunch, next.evening,
      next.morning_on, next.lunch_on, next.evening_on, me.id).run();
    return json({ ok: true, me: publicMember(next) });
  }

  if (path === "/push/subscribe" && method === "POST") {
    const { endpoint, keys } = await readBody(request);
    if (!/^https:\/\//.test(endpoint || "") || !keys?.p256dh || !keys?.auth) {
      throw new HttpError(400, "알림 등록 정보가 올바르지 않아요.");
    }
    await env.DB.prepare(
      `INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    ).bind(endpoint, me.id, keys.p256dh, keys.auth, nowIso()).run();
    return json({ ok: true });
  }

  if (path === "/push/unsubscribe" && method === "POST") {
    const { endpoint } = await readBody(request);
    await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?").bind(endpoint, me.id).run();
    return json({ ok: true });
  }

  if (path === "/push/test" && method === "POST") {
    const sent = await pushToMember(env, me.id, {
      title: "말씀 읽고 새 인생", body: "알림이 잘 도착했어요! 🙌", url: "/",
    });
    if (!sent) throw new HttpError(400, "이 사람에게 등록된 알림 기기가 없어요. 먼저 알림을 켜 주세요.");
    return json({ ok: true, sent });
  }

  throw new HttpError(404, "없는 요청이에요.");
}

function historyStmt(env, kind, day, before, after, memberName, note = null) {
  return env.DB.prepare(
    "INSERT INTO history (kind, day, before_value, after_value, member_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(kind, day, before, after, memberName, note, nowIso());
}

function setSettingStmt(env, key, value) {
  return value === null
    ? env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key)
    : env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(key, value);
}

async function replacePlan(env, plan, extra) {
  const stmts = [env.DB.prepare("DELETE FROM plan_days")];
  for (const d of plan) {
    if (!validChapters(d.chapters)) throw new HttpError(400, `DAY ${d.day} 범위가 올바르지 않아요.`);
    stmts.push(env.DB.prepare("INSERT INTO plan_days (day, chapters) VALUES (?, ?)").bind(d.day, JSON.stringify(d.chapters)));
  }
  await env.DB.batch([...stmts, ...extra]);
}

// 전체 편집 글 → [{day, chapters}]. 줄 순서대로 DAY 1, 2, 3 ... 이어야 한다.
function parseBulk(text) {
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new HttpError(400, "읽기표가 비어 있어요.");
  if (lines.length > 2000) throw new HttpError(400, "읽기표가 너무 길어요.");
  return lines.map((line, i) => {
    const m = line.match(/^(?:DAY\s*)?(\d+)\s*[:.)\t]?\s*(.*)$/i);
    if (!m) throw new HttpError(400, `${i + 1}번째 줄 "${line}"은 "DAY 1: 누가복음 1–3장" 형식이어야 해요.`);
    if (Number(m[1]) !== i + 1) throw new HttpError(400, `${i + 1}번째 줄의 DAY 번호가 ${m[1]}이에요. DAY는 1부터 차례대로 적어 주세요.`);
    const parsed = parseChapters(m[2]);
    if (parsed.error) throw new HttpError(400, `DAY ${m[1]}: ${parsed.error}`);
    return { day: i + 1, chapters: parsed.chapters };
  });
}

function describeHistory(h) {
  let summary;
  if (h.kind === "day") {
    summary = `DAY ${h.day}: ${formatChapters(JSON.parse(h.before_value))} → ${formatChapters(JSON.parse(h.after_value))}`;
  } else if (h.kind === "bulk") {
    const before = JSON.parse(h.before_value);
    const after = JSON.parse(h.after_value);
    const changed = [];
    for (let i = 0; i < Math.max(before.length, after.length); i++) {
      if (JSON.stringify(before[i]?.chapters) !== JSON.stringify(after[i]?.chapters)) changed.push(i + 1);
    }
    const days = changed.length > 6 ? `${changed.slice(0, 6).join(", ")} 외 ${changed.length - 6}일` : changed.join(", ");
    summary = `전체 표 편집 (${before.length}일 → ${after.length}일, 바뀐 DAY: ${days || "없음"})`;
  } else {
    summary = `시작일: ${h.before_value || "없음"} → ${h.after_value}`;
  }
  return { id: h.id, kind: h.kind, summary, memberName: h.member_name, note: h.note, createdAt: h.created_at };
}

// ── 알림 ───────────────────────────────────────────────
function vapidOf(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return null;
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}

async function pushToMember(env, memberId, data) {
  const vapid = vapidOf(env);
  if (!vapid) throw new HttpError(500, "서버에 알림 키가 설정되지 않았어요.");
  const { results: subs } = await env.DB.prepare("SELECT * FROM push_subscriptions WHERE member_id = ?").bind(memberId).all();
  let sent = 0;
  for (const sub of subs) {
    try {
      const r = await sendPush(sub, data, vapid);
      if (r.ok) sent++;
      else if (r.gone) await env.DB.prepare("DELETE FROM push_subscriptions WHERE endpoint = ?").bind(sub.endpoint).run();
      else console.error("push failed", r.status, sub.endpoint.slice(0, 60));
    } catch (e) {
      console.error("push error", e);
    }
  }
  return sent;
}

async function runNotifications(env, now) {
  const today = kstToday(now);
  const time = kstTime(now);
  const [plan, startDate, checks, { results: members }, { results: sentRows }] = await Promise.all([
    loadPlan(env), getSetting(env, "start_date"), loadChecks(env),
    env.DB.prepare("SELECT m.* FROM members m WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = m.id)").all(),
    env.DB.prepare("SELECT member_id, slot FROM sent_log WHERE date = ?").bind(today).all(),
  ]);
  if (!startDate) return;
  const sentBy = new Map();
  for (const r of sentRows) {
    if (!sentBy.has(r.member_id)) sentBy.set(r.member_id, new Set());
    sentBy.get(r.member_id).add(r.slot);
  }
  for (const m of members) {
    const slots = dueSlots(m, time, sentBy.get(m.id) || new Set());
    if (!slots.length) continue;
    const prog = progress(plan, startDate, today, checks.get(m.id) || new Map());
    // 여러 칸이 한꺼번에 밀렸으면 가장 최근 칸 하나만 보낸다
    const slot = slots[slots.length - 1];
    const msg = buildMessage(slot, prog);
    const log = env.DB.prepare("INSERT OR IGNORE INTO sent_log (member_id, date, slot) VALUES (?, ?, ?)");
    await env.DB.batch(slots.map((s) => log.bind(m.id, today, s)));
    if (msg) await pushToMember(env, m.id, { ...msg, url: "/", tag: `daily-${today}` });
  }
  // 오래된 발송 기록 정리
  await env.DB.prepare("DELETE FROM sent_log WHERE date < ?").bind(kstToday(now - 7 * 86400000)).run();
}
