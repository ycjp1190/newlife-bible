// "말씀 읽고 새 인생" 서버 (Cloudflare Worker)
// - /api/* : 앱 데이터 API
// - 그 외   : public/ 폴더의 앱 화면
// - 5분마다 : 알림 발송 (wrangler.toml 의 crons)
//
// 두 가지 모드로 배포된다 (wrangler.toml 의 MODE 값)
// - 모임 모드(기본): 초대 코드로 입장, 시작일·읽기표를 모두가 함께 씀 (schema.sql)
// - 개인 모드(MODE=personal): 코드 없이 시작, 사람마다 시작일·읽기표가 따로 (schema-personal.sql)
import {
  dayIndex, formatChapters, kstTime, kstToday, parseChapters, validChapters,
} from "../public/shared/bible.js";
import {
  buildPlan, isFixed, isRoadmap, mcheyneDays, mcheyneYearLength, ROADMAPS,
} from "../public/shared/roadmaps.js";
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
const isPersonal = (env) => env.MODE === "personal";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveAsset(request, env, url);
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

// 개인 모드는 아이콘·manifest 를 public/personal/ 의 것으로 바꿔 보여 준다.
// 모임 모드에서는 public/personal/ 을 보여 주지 않는다.
function serveAsset(request, env, url) {
  const p = url.pathname;
  if (p.startsWith("/personal/")) return new Response("Not found", { status: 404 });
  if (isPersonal(env) && (p === "/manifest.webmanifest" || p.startsWith("/icons/"))) {
    return env.ASSETS.fetch(new Request(new URL("/personal" + p, url), request));
  }
  if (isPersonal(env) && (p === "/" || p === "/index.html")) return personalIndex(request, env);
  return env.ASSETS.fetch(request);
}

// 개인 모드 첫 화면: 브라우저 탭 제목과 아이폰 홈 화면 이름에 "개인용"을 붙인다
async function personalIndex(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok || !(res.headers.get("Content-Type") || "").includes("text/html")) return res;
  const html = (await res.text())
    .replace("<title>말씀 읽고 새 인생</title>", "<title>말씀 읽고 새 인생 (개인용)</title>")
    .replace('name="apple-mobile-web-app-title" content="말씀 새 인생"', 'name="apple-mobile-web-app-title" content="말씀 새 인생 개인용"');
  const headers = new Headers(res.headers);
  headers.delete("Content-Length");
  headers.delete("ETag");
  return new Response(html, { status: res.status, headers });
}

// ── DB 읽기·쓰기 도우미 ─────────────────────────────────
// 읽기표·시작일·변경 기록은 모임 모드에선 모두 공용, 개인 모드에선 사람(me)별이다.

async function loadPlan(env, me) {
  const stmt = isPersonal(env)
    ? env.DB.prepare("SELECT day, chapters FROM member_plan WHERE member_id = ? ORDER BY day").bind(me.id)
    : env.DB.prepare("SELECT day, chapters FROM plan_days ORDER BY day");
  const { results } = await stmt.all();
  return results.map((r) => ({ day: r.day, chapters: JSON.parse(r.chapters) }));
}

function getDayRow(env, me, day) {
  return isPersonal(env)
    ? env.DB.prepare("SELECT chapters FROM member_plan WHERE member_id = ? AND day = ?").bind(me.id, day).first()
    : env.DB.prepare("SELECT chapters FROM plan_days WHERE day = ?").bind(day).first();
}

function setDayStmt(env, me, day, chapters) {
  return isPersonal(env)
    ? env.DB.prepare("UPDATE member_plan SET chapters = ? WHERE member_id = ? AND day = ?").bind(chapters, me.id, day)
    : env.DB.prepare("UPDATE plan_days SET chapters = ? WHERE day = ?").bind(chapters, day);
}

async function replacePlan(env, me, plan, extra) {
  for (const d of plan) {
    if (!validChapters(d.chapters)) throw new HttpError(400, `DAY ${d.day} 범위가 올바르지 않아요.`);
  }
  if (isPersonal(env)) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM member_plan WHERE member_id = ?").bind(me.id),
      insertPlanStmt(env, me.id, plan, 1),
      ...extra,
    ]);
    return;
  }
  const stmts = [env.DB.prepare("DELETE FROM plan_days")];
  for (const d of plan) {
    stmts.push(env.DB.prepare("INSERT INTO plan_days (day, chapters) VALUES (?, ?)").bind(d.day, JSON.stringify(d.chapters)));
  }
  await env.DB.batch([...stmts, ...extra]);
}

// 개인 모드: 읽기표 여러 날을 쿼리 한 번으로 넣는다. firstDay 부터 차례로 DAY 번호를 붙인다.
function insertPlanStmt(env, memberId, plan, firstDay) {
  return env.DB.prepare(
    "INSERT INTO member_plan (member_id, day, chapters) SELECT ?, key + ?, value FROM json_each(?)",
  ).bind(memberId, firstDay, JSON.stringify(plan.map((d) => d.chapters)));
}

// 맥체인: 남은 날이 14일 아래로 줄면 다음 1년치를 덧붙인다 (1년 뒤에도 계속 읽도록)
async function ensureMcheyneHorizon(env, me, today = kstToday()) {
  if (!isPersonal(env) || me.roadmap !== "mcheyne") return;
  const row = await env.DB.prepare("SELECT MAX(day) AS last FROM member_plan WHERE member_id = ?").bind(me.id).first();
  const last = row?.last || 0;
  if (dayIndex(me.start_date, today) <= last - 14) return;
  const endDate = new Date(Date.parse(me.start_date + "T00:00:00Z") + last * 86400000).toISOString().slice(0, 10);
  const more = mcheyneDays(me.start_date, last + 1, last + mcheyneYearLength(endDate));
  await insertPlanStmt(env, me.id, more, last + 1).run();
}

// 개인 모드 계획 선택값 검사 → { roadmap, perDay, startDate }
function checkPlanChoice(body) {
  const roadmap = body.roadmap ?? "flow397";
  if (!isRoadmap(roadmap)) throw new HttpError(400, "읽기 로드맵을 골라 주세요.");
  const perDay = isFixed(roadmap) ? 4 : Number(body.per_day ?? 3);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 10) throw new HttpError(400, "하루 분량은 1–10장 사이로 골라 주세요.");
  return { roadmap, perDay, startDate: checkDate(body.start_date) };
}

const planText = (roadmap, perDay) => (isFixed(roadmap) ? ROADMAPS[roadmap].name : `${ROADMAPS[roadmap].name} · 하루 ${perDay}장`);

async function getStartDate(env, me) {
  if (isPersonal(env)) return me.start_date;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'start_date'").first();
  return row ? row.value : null;
}

function setStartDateStmt(env, me, value) {
  if (isPersonal(env)) return env.DB.prepare("UPDATE members SET start_date = ? WHERE id = ?").bind(value, me.id);
  return value === null
    ? env.DB.prepare("DELETE FROM settings WHERE key = 'start_date'")
    : env.DB.prepare("INSERT INTO settings (key, value) VALUES ('start_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .bind(value);
}

function historyStmt(env, me, kind, day, before, after, note = null) {
  return isPersonal(env)
    ? env.DB.prepare(
      "INSERT INTO history (member_id, plan_version, kind, day, before_value, after_value, member_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(me.id, me.plan_version, kind, day, before, after, me.name, note, nowIso())
    : env.DB.prepare(
      "INSERT INTO history (kind, day, before_value, after_value, member_name, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(kind, day, before, after, me.name, note, nowIso());
}

// Map<memberId, Map<day, Set<chapterKey>>>
async function loadChecks(env, memberId = null) {
  const current = "SELECT c.member_id, c.day, c.chapter FROM checks c JOIN members m ON m.id = c.member_id AND c.plan_version = m.plan_version";
  let stmt;
  if (isPersonal(env)) {
    stmt = memberId === null ? env.DB.prepare(current) : env.DB.prepare(`${current} WHERE c.member_id = ?`).bind(memberId);
  } else {
    stmt = memberId === null
      ? env.DB.prepare("SELECT member_id, day, chapter FROM checks")
      : env.DB.prepare("SELECT member_id, day, chapter FROM checks WHERE member_id = ?").bind(memberId);
  }
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
  ...(m.recovery_code ? { recoveryCode: m.recovery_code } : {}),
});

async function readBody(request) {
  try { return await request.json(); } catch { throw new HttpError(400, "요청 내용을 읽지 못했어요."); }
}

function cleanName(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (!n || n.length > 20) throw new HttpError(400, "이름은 1–20자로 적어 주세요.");
  return n;
}

function checkDate(value) {
  if (!DATE_RE.test(value || "") || Number.isNaN(Date.parse(value))) {
    throw new HttpError(400, "날짜 형식이 올바르지 않아요.");
  }
  return value;
}

const newToken = () => b64urlEncode(crypto.getRandomValues(new Uint8Array(24)));

// 헷갈리는 글자(0/O, 1/I/L)를 뺀 8자리 복구 코드. 예: "K7MX-Q2PD"
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function newRecoveryCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const s = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}
const normalizeCode = (code) => {
  const s = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
};

// ── API ────────────────────────────────────────────────
async function handleApi(request, env, url) {
  const path = url.pathname.slice(4); // "/api" 제거
  const method = request.method;

  // 앱 화면이 어떤 모드로 그릴지 알려 준다 (입장 전에도 필요)
  if (path === "/config" && method === "GET") {
    return json({ mode: isPersonal(env) ? "personal" : "group" });
  }

  if (path === "/join" && method === "POST") {
    return isPersonal(env) ? joinPersonal(request, env) : joinGroup(request, env);
  }

  // 개인 모드: 복구 코드로 다른 기기에서 이어 쓰기
  if (path === "/recover" && method === "POST" && isPersonal(env)) {
    const { code } = await readBody(request);
    const c = normalizeCode(code);
    const me = c && await env.DB.prepare("SELECT * FROM members WHERE recovery_code = ?").bind(c).first();
    if (!me) throw new HttpError(404, "복구 코드가 맞지 않아요. 다시 확인해 주세요.");
    return json({ token: me.token, member: publicMember(me) });
  }

  const me = await authMember(request, env);

  if (path === "/state" && method === "GET") {
    await ensureMcheyneHorizon(env, me);
    const [plan, startDate, checks] = await Promise.all([
      loadPlan(env, me), getStartDate(env, me), loadChecks(env, me.id),
    ]);
    const mine = {};
    for (const [day, set] of checks.get(me.id) || []) mine[day] = [...set];
    return json({
      mode: isPersonal(env) ? "personal" : "group",
      roadmap: isPersonal(env) ? me.roadmap : "flow397",
      perDay: isPersonal(env) ? me.per_day : 3,
      me: publicMember(me), plan, startDate, today: kstToday(), checks: mine,
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
    });
  }

  if (path === "/check" && method === "POST") {
    const { day, chapter, checked } = await readBody(request);
    if (!Number.isInteger(day) || typeof chapter !== "string" || chapter.length > 40) {
      throw new HttpError(400, "잘못된 체크 요청이에요.");
    }
    if (isPersonal(env)) {
      await (checked
        ? env.DB.prepare("INSERT OR IGNORE INTO checks (member_id, plan_version, day, chapter, checked_at) VALUES (?, ?, ?, ?, ?)")
          .bind(me.id, me.plan_version, day, chapter, nowIso())
        : env.DB.prepare("DELETE FROM checks WHERE member_id = ? AND plan_version = ? AND day = ? AND chapter = ?")
          .bind(me.id, me.plan_version, day, chapter)).run();
    } else if (checked) {
      await env.DB.prepare("INSERT OR IGNORE INTO checks (member_id, day, chapter, checked_at) VALUES (?, ?, ?, ?)")
        .bind(me.id, day, chapter, nowIso()).run();
    } else {
      await env.DB.prepare("DELETE FROM checks WHERE member_id = ? AND day = ? AND chapter = ?")
        .bind(me.id, day, chapter).run();
    }
    return json({ ok: true });
  }

  // 함께 읽기: 모든 사람의 진행 현황 (모임 모드 전용)
  if (path === "/members" && method === "GET" && !isPersonal(env)) {
    const [plan, startDate, checks, { results: members }] = await Promise.all([
      loadPlan(env, me), getStartDate(env, me), loadChecks(env),
      env.DB.prepare("SELECT id, name, last_seen_at FROM members ORDER BY name").all(),
    ]);
    const today = kstToday();
    return json({
      members: members.map((m) => {
        const p = progress(plan, startDate, today, checks.get(m.id) || new Map());
        return {
          id: m.id, name: m.name, lastSeenAt: m.last_seen_at,
          doneDays: p.doneDays, total: p.total, missedDays: p.missed.length,
          todayDone: p.todayDone, streak: p.streak,
          todayChecked: p.todayChapters.length - p.todayRemaining.length,
          todayTotal: p.todayChapters.length,
        };
      }),
    });
  }

  const fixedPlan = isPersonal(env) && isFixed(me.roadmap);
  if (fixedPlan && ((path.startsWith("/plan/") && path !== "/plan/choose") || path === "/settings" || /^\/history\/\d+\/revert$/.test(path))) {
    throw new HttpError(403, "맥체인 읽기표는 바꿀 수 없어요. 설정의 '계획 바꾸기'를 이용해 주세요.");
  }

  // 개인 모드: 읽기 계획(로드맵·하루 분량·시작일) 바꾸기. 새 계획으로 DAY 1 부터 다시 시작, 이전 체크는 보관.
  if (path === "/plan/choose" && method === "PUT" && isPersonal(env)) {
    const { roadmap, perDay, startDate } = checkPlanChoice(await readBody(request));
    const version = me.plan_version + 1;
    const next = { ...me, roadmap, per_day: perDay, start_date: startDate, plan_version: version };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM member_plan WHERE member_id = ?").bind(me.id),
      insertPlanStmt(env, me.id, buildPlan(roadmap, perDay, startDate), 1),
      env.DB.prepare("UPDATE members SET roadmap = ?, per_day = ?, start_date = ?, plan_version = ? WHERE id = ?")
        .bind(roadmap, perDay, startDate, version, me.id),
      historyStmt(env, next, "plan", null,
        `${planText(me.roadmap, me.per_day)} (${me.start_date} 시작)`, `${planText(roadmap, perDay)} (${startDate} 시작)`),
    ]);
    return json({ ok: true });
  }

  // 하루 범위 수정
  const dayMatch = path.match(/^\/plan\/day\/(\d+)$/);
  if (dayMatch && method === "PUT") {
    const day = Number(dayMatch[1]);
    const { text } = await readBody(request);
    const parsed = parseChapters(text);
    if (parsed.error) throw new HttpError(400, parsed.error);
    const row = await getDayRow(env, me, day);
    if (!row) throw new HttpError(404, `DAY ${day}가 없어요.`);
    const after = JSON.stringify(parsed.chapters);
    if (after === row.chapters) return json({ ok: true, unchanged: true });
    await env.DB.batch([
      setDayStmt(env, me, day, after),
      historyStmt(env, me, "day", day, row.chapters, after),
    ]);
    return json({ ok: true, chapters: parsed.chapters });
  }

  // 전체 읽기표 직접 편집 (한 줄에 하루: "DAY 1: 누가복음 1–3장")
  if (path === "/plan/bulk" && method === "PUT") {
    const { text } = await readBody(request);
    const plan = parseBulk(text);
    const before = JSON.stringify(await loadPlan(env, me));
    const after = JSON.stringify(plan);
    if (before === after) return json({ ok: true, unchanged: true });
    await replacePlan(env, me, plan, [historyStmt(env, me, "bulk", null, before, after)]);
    return json({ ok: true, days: plan.length });
  }

  if (path === "/history" && method === "GET") {
    const cols = "id, kind, day, before_value, after_value, member_name, note, created_at";
    const stmt = isPersonal(env)
      ? env.DB.prepare(`SELECT ${cols} FROM history WHERE member_id = ? AND plan_version = ? ORDER BY id DESC LIMIT 100`)
        .bind(me.id, me.plan_version)
      : env.DB.prepare(`SELECT ${cols} FROM history ORDER BY id DESC LIMIT 100`);
    const { results } = await stmt.all();
    return json({ history: results.map(describeHistory) });
  }

  const revertMatch = path.match(/^\/history\/(\d+)\/revert$/);
  if (revertMatch && method === "POST") {
    const h = await env.DB.prepare("SELECT * FROM history WHERE id = ?").bind(Number(revertMatch[1])).first();
    if (!h || (isPersonal(env) && (h.member_id !== me.id || h.plan_version !== me.plan_version))) {
      throw new HttpError(404, "변경 기록을 찾지 못했어요.");
    }
    if (h.kind === "plan") throw new HttpError(409, "계획 바꾸기는 되돌릴 수 없어요. '계획 바꾸기'로 다시 골라 주세요.");
    const note = `#${h.id} 되돌리기`;
    if (h.kind === "day") {
      const row = await getDayRow(env, me, h.day);
      if (!row) throw new HttpError(409, `DAY ${h.day}가 지금 읽기표에 없어요.`);
      await env.DB.batch([
        setDayStmt(env, me, h.day, h.before_value),
        historyStmt(env, me, "day", h.day, row.chapters, h.before_value, note),
      ]);
    } else if (h.kind === "bulk") {
      const current = JSON.stringify(await loadPlan(env, me));
      await replacePlan(env, me, JSON.parse(h.before_value), [
        historyStmt(env, me, "bulk", null, current, h.before_value, note),
      ]);
    } else if (h.kind === "start_date") {
      if (isPersonal(env) && !h.before_value) throw new HttpError(409, "처음 정한 시작일은 되돌릴 수 없어요.");
      const current = await getStartDate(env, me);
      await env.DB.batch([
        setStartDateStmt(env, me, h.before_value),
        historyStmt(env, me, "start_date", null, current, h.before_value, note),
      ]);
    }
    return json({ ok: true });
  }

  // 시작일 변경 (모임: 모두 공통 / 개인: 나만)
  if (path === "/settings" && method === "PUT") {
    const { start_date } = await readBody(request);
    checkDate(start_date);
    const current = await getStartDate(env, me);
    if (current === start_date) return json({ ok: true, unchanged: true });
    await env.DB.batch([
      setStartDateStmt(env, me, start_date),
      historyStmt(env, me, "start_date", null, current, start_date),
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
    if (next.name !== me.name && !isPersonal(env)) {
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
      title: isPersonal(env) ? "말씀 읽고 새 인생 (개인용)" : "말씀 읽고 새 인생", body: "알림이 잘 도착했어요! 🙌", url: "/",
    });
    if (!sent) throw new HttpError(400, "이 사람에게 등록된 알림 기기가 없어요. 먼저 알림을 켜 주세요.");
    return json({ ok: true, sent });
  }

  throw new HttpError(404, "없는 요청이에요.");
}

// 모임 모드 입장 (초대 코드 + 이름). 같은 이름이 있으면 그 사람으로 이어서 사용
async function joinGroup(request, env) {
  const { name, invite } = await readBody(request);
  if (!env.INVITE_CODE || String(invite || "").trim() !== env.INVITE_CODE) {
    throw new HttpError(403, "초대 코드가 맞지 않아요.");
  }
  const n = cleanName(name);
  let me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
  if (!me) {
    await env.DB.prepare("INSERT INTO members (name, token, created_at) VALUES (?, ?, ?)")
      .bind(n, newToken(), nowIso()).run();
    me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
  }
  return json({ token: me.token, member: publicMember(me) });
}

// 개인 모드 시작 (이름 + 시작일). 기본 읽기표를 복사해 나만의 읽기표를 만든다.
async function joinPersonal(request, env) {
  const body = await readBody(request);
  const n = cleanName(body.name);
  // roadmap·per_day 가 없으면(예전 화면) 예수님에서 시작하는 통독 · 하루 3장
  const { roadmap, perDay, startDate: start_date } = checkPlanChoice(body);
  const token = newToken();
  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(
        "INSERT INTO members (name, token, recovery_code, start_date, roadmap, per_day, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).bind(n, token, newRecoveryCode(), start_date, roadmap, perDay, nowIso()).run();
      break;
    } catch (e) {
      if (attempt >= 3) throw e; // 복구 코드가 우연히 겹치면 다시 만든다
    }
  }
  const me = await env.DB.prepare("SELECT * FROM members WHERE token = ?").bind(token).first();
  await insertPlanStmt(env, me.id, buildPlan(roadmap, perDay, start_date), 1).run();
  return json({ token, member: publicMember(me) });
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
  } else if (h.kind === "plan") {
    summary = `읽기 계획: ${h.before_value} → ${h.after_value}`;
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
  const [checks, { results: members }, { results: sentRows }] = await Promise.all([
    loadChecks(env),
    env.DB.prepare("SELECT m.* FROM members m WHERE EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = m.id)").all(),
    env.DB.prepare("SELECT member_id, slot FROM sent_log WHERE date = ?").bind(today).all(),
  ]);
  // 모임 모드는 읽기표·시작일이 한 벌이므로 한 번만 읽는다
  const shared = isPersonal(env) ? null : { plan: await loadPlan(env, null), startDate: await getStartDate(env, null) };
  const sentBy = new Map();
  for (const r of sentRows) {
    if (!sentBy.has(r.member_id)) sentBy.set(r.member_id, new Set());
    sentBy.get(r.member_id).add(r.slot);
  }
  for (const m of members) {
    const slots = dueSlots(m, time, sentBy.get(m.id) || new Set());
    if (!slots.length) continue;
    if (!shared) await ensureMcheyneHorizon(env, m, today);
    const plan = shared ? shared.plan : await loadPlan(env, m);
    const startDate = shared ? shared.startDate : m.start_date;
    if (!startDate) continue;
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
