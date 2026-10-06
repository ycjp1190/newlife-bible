// "말씀 읽고 새 인생" 서버 (Cloudflare Worker)
// - /api/* : 앱 데이터 API
// - 그 외   : public/ 폴더의 앱 화면
// - 5분마다 : 알림 발송 (wrangler.toml 의 crons)
//
// 두 가지 모드로 배포된다 (wrangler.toml 의 MODE 값)
// - 모임 모드(기본): 초대 코드로 입장, 시작일·읽기표를 모두가 함께 씀 (schema.sql)
// - 개인 모드(MODE=personal): 코드 없이 시작, 사람마다 시작일·읽기표가 따로 (schema-personal.sql)
import {
  chapterKey, dateOfDaySched, dayIndex, dayOnDate, EVERY_DAY, formatChapters, kstTime, kstToday, MIN_READ_DAYS,
  parseChapters, validChapters, validMask, weekdaysText,
} from "../public/shared/bible.js";
import { latestNotice } from "../public/shared/notices.js";
import {
  buildPlan, fixedDays, isFixed, isRoadmap, ROADMAPS, yearLength,
} from "../public/shared/roadmaps.js";
import { buildMessage, dueSlots, missedByMonth, progress, SLOTS } from "./logic.js";
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

// 실시간 대화방: 대화 탭을 연 사람들의 웹소켓을 붙잡고 있다가, 무언가 바뀌면 "changed" 신호를 보낸다.
// 앱은 신호를 받으면 /api/chat 으로 바뀐 내용을 가져온다. (잠자기 방식이라 연결만 유지할 때는 거의 비용 없음)
export class ChatRoom {
  constructor(state) {
    this.state = state;
    // 앱이 30초마다 보내는 "ping" 에는 대화방을 깨우지 않고 자동으로 "pong" 응답
    state.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (request.headers.get("Upgrade") === "websocket") {
      const [client, server] = Object.values(new WebSocketPair());
      this.state.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    if (new URL(request.url).pathname === "/broadcast") {
      const msg = await request.text();
      for (const ws of this.state.getWebSockets()) {
        try { ws.send(msg); } catch { /* 이미 끊긴 연결 */ }
      }
      return new Response("ok");
    }
    return new Response("Not found", { status: 404 });
  }

  webSocketMessage() { /* 앱 → 서버 메시지는 쓰지 않음 */ }

  webSocketClose(ws, code) {
    try { ws.close(code, "bye"); } catch { /* 이미 닫힘 */ }
  }
}

// 대화방에 "바뀜" 신호 (실시간 연결이 없는 환경에서는 아무것도 안 함)
function signalChat(env, ctx) {
  if (!env.CHAT) return;
  const job = env.CHAT.get(env.CHAT.idFromName("room"))
    .fetch("https://chat-room/broadcast", { method: "POST", body: "changed" })
    .catch(() => {});
  if (ctx?.waitUntil) ctx.waitUntil(job);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveAsset(request, env, url);
    try {
      return await handleApi(request, env, url, ctx);
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
  if (isPersonal(env) && (p === "/" || p === "/index.html")) {
    return personalIndex(request, env);
  }
  return env.ASSETS.fetch(request);
}

// 개인용 링크를 카카오톡 등에 공유했을 때 보이는 미리보기 (제목·설명·아이콘)
const SHARE_DESC = "나에게 맞는 순서와 분량으로 성경 전체를 읽어요. 매일 읽을 곳을 알려 주고 장마다 체크해요.";
const shareMeta = (origin) => `<meta name="description" content="${SHARE_DESC}">
  <meta property="og:type" content="website">
  <meta property="og:title" content="말씀 읽고 새 인생 (개인용)">
  <meta property="og:description" content="${SHARE_DESC}">
  <meta property="og:url" content="${origin}/">
  <meta property="og:image" content="${origin}/icons/icon-512.png">`;

// 개인 모드 첫 화면: 브라우저 탭 제목과 아이폰 홈 화면 이름에 "개인용"을 붙인다
// (관리자 화면은 개인용 앱 안의 관리자 탭 — 설정의 '관리자'에서 코드를 넣으면 생긴다)
async function personalIndex(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (!res.ok || !(res.headers.get("Content-Type") || "").includes("text/html")) return res;
  let html = await res.text();
  html = html
    .replace("<title>말씀 읽고 새 인생</title>", "<title>말씀 읽고 새 인생 (개인용)</title>")
    .replace('name="apple-mobile-web-app-title" content="말씀 새 인생"', 'name="apple-mobile-web-app-title" content="말씀 새 인생 개인용"')
    .replace(/<meta name="description" content="[^"]*">/, () => shareMeta(new URL(request.url).origin));
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

// 달력형(공동체성경읽기·맥체인): 남은 날이 14일 아래로 줄면 다음 1년치를 덧붙인다 (1년 뒤에도 계속 읽도록)
async function ensureMcheyneHorizon(env, me, today = kstToday()) {
  if (!isPersonal(env) || !isFixed(me.roadmap)) return;
  const row = await env.DB.prepare("SELECT MAX(day) AS last FROM member_plan WHERE member_id = ?").bind(me.id).first();
  const last = row?.last || 0;
  if (dayIndex(me.start_date, today) <= last - 14) return;
  const endDate = new Date(Date.parse(me.start_date + "T00:00:00Z") + last * 86400000).toISOString().slice(0, 10);
  const more = fixedDays(me.roadmap, me.start_date, last + 1, last + yearLength(endDate));
  await insertPlanStmt(env, me.id, more, last + 1).run();
}

// 읽는 요일 일정 [{date, day, mask}] (요일을 바꾼 적 없으면 시작일부터 readDays)
function schedFrom(startDate, readDays, schedJson) {
  if (!startDate) return null;
  if (schedJson) { try { return JSON.parse(schedJson); } catch { /* 아래 기본값 */ } }
  return [{ date: startDate, day: 1, mask: readDays ?? EVERY_DAY }];
}
const memberSched = (me) => schedFrom(me.start_date, me.read_days, me.sched);

// 개인 = 사람마다(members 칸), 모임 = 모두 공통(settings 의 start_date·read_days·sched)
async function getSchedule(env, me) {
  if (isPersonal(env)) return { startDate: me.start_date, readDays: me.read_days ?? EVERY_DAY, sched: memberSched(me) };
  const { results } = await env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('start_date', 'read_days', 'sched')").all();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const readDays = v.read_days ? Number(v.read_days) : EVERY_DAY;
  return { startDate: v.start_date || null, readDays, sched: schedFrom(v.start_date, readDays, v.sched) };
}

const setSetting = (env, key, value) => (value === null
  ? env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key)
  : env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value)));

function checkMask(value) {
  const mask = Number(value);
  if (!validMask(mask)) throw new HttpError(400, `읽는 요일은 ${MIN_READ_DAYS}일 이상 골라 주세요.`);
  return mask;
}

// 개인 모드 계획 선택값 검사 → { roadmap, perDay, startDate, readDays }
function checkPlanChoice(body) {
  const roadmap = body.roadmap ?? "flow397";
  if (!isRoadmap(roadmap)) throw new HttpError(400, "읽기 로드맵을 골라 주세요.");
  const perDay = isFixed(roadmap) ? 4 : Number(body.per_day ?? 3);
  if (!Number.isInteger(perDay) || perDay < 1 || perDay > 10) throw new HttpError(400, "하루 분량은 1–10장 사이로 골라 주세요.");
  // 달력형(333·맥체인)은 날짜별 본문이라 매일만
  const readDays = isFixed(roadmap) ? EVERY_DAY : checkMask(body.read_days ?? EVERY_DAY);
  return { roadmap, perDay, startDate: checkDate(body.start_date), readDays };
}

const planText = (roadmap, perDay, readDays = EVERY_DAY) => (isFixed(roadmap) ? ROADMAPS[roadmap].name
  : `${ROADMAPS[roadmap].name} · 하루 ${perDay}장${readDays === EVERY_DAY ? "" : ` · ${weekdaysText(readDays)}`}`);

async function getStartDate(env, me) {
  if (isPersonal(env)) return me.start_date;
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'start_date'").first();
  return row ? row.value : null;
}

// 시작일을 바꾸면 요일 구간 기록은 비우고 새 시작일부터 지금 요일로
function setStartDateStmts(env, me, value) {
  if (isPersonal(env)) return [env.DB.prepare("UPDATE members SET start_date = ?, sched = NULL WHERE id = ?").bind(value, me.id)];
  return [setSetting(env, "start_date", value), setSetting(env, "sched", null)];
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
  const now = nowIso();
  // 개인 모드: 홈 화면 앱(설치형)으로 열었으면 그 시각도 기록 (관리자 통계용)
  if (isPersonal(env) && request.headers.get("X-App-Mode") === "standalone") {
    await env.DB.prepare("UPDATE members SET last_seen_at = ?, app_last_at = ?, app_first_at = COALESCE(app_first_at, ?) WHERE id = ?")
      .bind(now, now, now, me.id).run();
  } else {
    await env.DB.prepare("UPDATE members SET last_seen_at = ? WHERE id = ?").bind(now, me.id).run();
  }
  return me;
}

// 관리자 코드 확인 (길이와 상관없이 비교 시간이 일정하게)
function sameCode(a, b) {
  const x = new TextEncoder().encode(String(a || ""));
  const y = new TextEncoder().encode(String(b || ""));
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

// 관리자 통계 (개인 모드, ADMIN_CODE 가 설정된 경우만). 운영자 전용이라 실명을 보여 준다.
// personalOnly: 사용자 통계·계정 삭제는 개인 모드에서만 (모임 모드 관리자 탭은 의견·제보만)
function checkAdmin(request, env, personalOnly = false) {
  if ((personalOnly && !isPersonal(env)) || !env.ADMIN_CODE) throw new HttpError(404, "없는 요청이에요.");
  let given = request.headers.get("X-Admin-Code") || "";
  try { given = decodeURIComponent(given); } catch { /* 그대로 비교 */ }
  if (!sameCode(given, env.ADMIN_CODE)) throw new HttpError(403, "관리자 코드가 맞지 않아요.");
}

// 운영자 점검용 이름 (wrangler.toml 의 TEST_NAMES, 쉼표로 구분, 대소문자 구분 없음) → 통계·인원수에서 뺀다
const testNames = (env) => new Set(String(env.TEST_NAMES || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));

// 관리자: 사용자 한 명과 그 기록을 모두 지운다 (되돌릴 수 없음)
async function adminDelete(request, env) {
  checkAdmin(request, env, true);
  const { id } = await readBody(request);
  if (!Number.isInteger(id)) throw new HttpError(400, "잘못된 요청이에요.");
  const m = await env.DB.prepare("SELECT id FROM members WHERE id = ?").bind(id).first();
  if (!m) throw new HttpError(404, "그런 사용자가 없어요.");
  await env.DB.batch(["member_plan", "checks", "history", "push_subscriptions", "sent_log", "feedback"]
    .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE member_id = ?`).bind(id))
    .concat(env.DB.prepare("DELETE FROM members WHERE id = ?").bind(id)));
  return json({ ok: true });
}

async function adminStats(request, env) {
  checkAdmin(request, env, true);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.name, m.roadmap, m.per_day, m.start_date, m.created_at, m.last_seen_at, m.app_first_at, m.app_last_at,
       EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = m.id) AS push,
       (SELECT COUNT(*) FROM checks c WHERE c.member_id = m.id AND c.plan_version = m.plan_version) AS checked
     FROM members m ORDER BY m.id`,
  ).all();
  const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
  const d1 = ago(1);
  const d7 = ago(7);
  const users = results.map((r) => ({
    no: r.id, name: r.name, roadmap: r.roadmap, perDay: r.per_day, startDate: r.start_date,
    createdAt: r.created_at, lastSeenAt: r.last_seen_at, appFirstAt: r.app_first_at, appLastAt: r.app_last_at,
    push: !!r.push, checked: r.checked, test: testNames(env).has(String(r.name).trim().toLowerCase()),
  }));
  const real = users.filter((u) => !u.test);
  const count = (f) => real.filter(f).length;
  return json({
    summary: {
      total: real.length,
      tests: users.length - real.length,
      installed: count((u) => u.appFirstAt),
      installed7: count((u) => u.appLastAt && u.appLastAt >= d7),
      active1: count((u) => u.lastSeenAt && u.lastSeenAt >= d1),
      active7: count((u) => u.lastSeenAt && u.lastSeenAt >= d7),
      push: count((u) => u.push),
      byRoadmap: Object.fromEntries(Object.keys(ROADMAPS).map((id) => [id, count((u) => u.roadmap === id)])),
    },
    users,
  });
}

const publicMember = (m) => ({
  id: m.id, name: m.name,
  morning: m.morning, lunch: m.lunch, evening: m.evening,
  morning_on: !!m.morning_on, lunch_on: !!m.lunch_on, evening_on: !!m.evening_on,
  ...(m.recovery_code ? { recoveryCode: m.recovery_code } : {}),
  ...(m.chat_push !== undefined ? { chat_push: !!m.chat_push } : {}),
  ...(m.join_day !== undefined ? { joinDay: m.join_day } : {}),
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
async function handleApi(request, env, url, ctx) {
  const path = url.pathname.slice(4); // "/api" 제거
  const method = request.method;

  // 관리자 앱 주소에서는 관리자 기능만

  // 앱 화면이 어떤 모드로 그릴지 알려 준다 (입장 전에도 필요)
  if (path === "/config" && method === "GET") {
    return json({ mode: isPersonal(env) ? "personal" : "group" });
  }

  if (path === "/join" && method === "POST") {
    return isPersonal(env) ? joinPersonal(request, env) : joinGroup(request, env, ctx);
  }

  // 개인 모드: 복구 코드로 다른 기기에서 이어 쓰기
  if (path === "/recover" && method === "POST" && isPersonal(env)) {
    const { code } = await readBody(request);
    const c = normalizeCode(code);
    const me = c && await env.DB.prepare("SELECT * FROM members WHERE recovery_code = ?").bind(c).first();
    if (!me) throw new HttpError(404, "복구 코드가 맞지 않아요. 다시 확인해 주세요.");
    return json({ token: me.token, member: publicMember(me) });
  }

  // 관리자 통계 (로그인 대신 관리자 코드)
  if (path === "/admin/stats" && method === "GET") return adminStats(request, env);
  if (path === "/admin/delete" && method === "POST") return adminDelete(request, env);
  if (path === "/admin/feedback" && method === "GET") return adminFeedbackList(request, env);
  const fbMatch = path.match(/^\/admin\/feedback\/(\d+)$/);
  if (fbMatch && method === "POST") return adminFeedbackUpdate(request, env, ctx, Number(fbMatch[1]));

  // 대화 실시간 연결 (모임 모드 전용)
  if (path === "/chat/ws") {
    if (isPersonal(env)) throw new HttpError(404, "없는 요청이에요.");
    const token = url.searchParams.get("token") || "";
    const who = token && await env.DB.prepare("SELECT id FROM members WHERE token = ?").bind(token).first();
    if (!who) throw new HttpError(401, "다시 입장해 주세요.");
    if (!env.CHAT) throw new HttpError(404, "실시간 연결을 쓸 수 없어요.");
    if (request.headers.get("Upgrade") !== "websocket") throw new HttpError(426, "웹소켓 연결이 필요해요.");
    return env.CHAT.get(env.CHAT.idFromName("room")).fetch(request);
  }

  const me = await authMember(request, env);

  if (path === "/state" && method === "GET") {
    await ensureMcheyneHorizon(env, me);
    const [plan, { startDate, readDays, sched }, checks] = await Promise.all([
      loadPlan(env, me), getSchedule(env, me), loadChecks(env, me.id),
    ]);
    const mine = {};
    for (const [day, set] of checks.get(me.id) || []) mine[day] = [...set];
    return json({
      mode: isPersonal(env) ? "personal" : "group",
      roadmap: isPersonal(env) ? me.roadmap : "flow397",
      perDay: isPersonal(env) ? me.per_day : 3,
      readDays, sched, noticeSeen: me.notice_seen ?? 0,
      me: publicMember(me), plan, startDate, today: kstToday(), checks: mine,
      vapidPublicKey: env.VAPID_PUBLIC_KEY || null,
      ...(isPersonal(env) ? {} : { chatUnread: await chatUnread(env, me) }),
      feedbackReplies: (await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE member_id = ? AND reply_seen = 0").bind(me.id).first())?.n || 0,
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
      if (await postDoneIfToday(env, me, day)) signalChat(env, ctx);
    } else {
      await env.DB.prepare("DELETE FROM checks WHERE member_id = ? AND day = ? AND chapter = ?")
        .bind(me.id, day, chapter).run();
      if (await removeDone(env, me, day)) signalChat(env, ctx);
    }
    return json({ ok: true });
  }

  // 대화(단톡방) — 모임 모드 전용
  if (path === "/chat" || path.startsWith("/chat/")) {
    if (isPersonal(env)) throw new HttpError(404, "없는 요청이에요.");
    return handleChat(request, env, ctx, me, path, method, url);
  }

  // 함께 읽기: 모든 사람의 진행 현황 (모임 모드 전용)
  if (path === "/members" && method === "GET" && !isPersonal(env)) {
    const [plan, { sched }, checks, { results: members }] = await Promise.all([
      loadPlan(env, me), getSchedule(env, me), loadChecks(env),
      env.DB.prepare("SELECT id, name, last_seen_at, join_day FROM members ORDER BY name").all(),
    ]);
    const today = kstToday();
    return json({
      members: members.map((m) => {
        const p = progress(plan, sched, today, checks.get(m.id) || new Map(), m.join_day);
        const thisMonth = sched ? missedByMonth(p.missedDetail, sched).find((x) => x.month === today.slice(0, 7)) : null;
        return {
          id: m.id, name: m.name, lastSeenAt: m.last_seen_at, joinDay: m.join_day,
          doneDays: p.doneDays, total: p.total, missedDays: p.missed.length,
          missedChapters: p.missedChapters, thisMonth: thisMonth || { chapters: 0, days: 0 },
          todayDone: p.todayDone, streak: p.streak,
          todayChecked: p.todayChapters.length - p.todayRemaining.length,
          todayTotal: p.todayChapters.length,
        };
      }),
    });
  }

  const fixedPlan = isPersonal(env) && isFixed(me.roadmap);
  if (fixedPlan && ((path.startsWith("/plan/") && path !== "/plan/choose") || path === "/settings" || path === "/read-days" || /^\/history\/\d+\/revert$/.test(path))) {
    throw new HttpError(403, `${ROADMAPS[me.roadmap].name} 읽기표는 바꿀 수 없어요. 설정의 '계획 바꾸기'를 이용해 주세요.`);
  }

  // 개인 모드: 읽기 계획(로드맵·하루 분량·시작일) 바꾸기. 새 계획으로 DAY 1 부터 다시 시작, 이전 체크는 보관.
  if (path === "/plan/choose" && method === "PUT" && isPersonal(env)) {
    const { roadmap, perDay, startDate, readDays } = checkPlanChoice(await readBody(request));
    const version = me.plan_version + 1;
    const next = { ...me, roadmap, per_day: perDay, start_date: startDate, plan_version: version };
    await env.DB.batch([
      env.DB.prepare("DELETE FROM member_plan WHERE member_id = ?").bind(me.id),
      insertPlanStmt(env, me.id, buildPlan(roadmap, perDay, startDate), 1),
      env.DB.prepare("UPDATE members SET roadmap = ?, per_day = ?, start_date = ?, plan_version = ?, read_days = ?, sched = NULL WHERE id = ?")
        .bind(roadmap, perDay, startDate, version, readDays, me.id),
      historyStmt(env, next, "plan", null,
        `${planText(me.roadmap, me.per_day, me.read_days)} (${me.start_date} 시작)`, `${planText(roadmap, perDay, readDays)} (${startDate} 시작)`),
    ]);
    return json({ ok: true });
  }

  // 읽는 요일 바꾸기 — 개인: 나만, 모임: 모두에게 (오늘부터 적용, 지난 날의 DAY·날짜·체크는 그대로)
  if (path === "/read-days" && method === "PUT") {
    const mask = checkMask((await readBody(request)).mask);
    const { startDate, readDays: before, sched: cur } = await getSchedule(env, me);
    if (!startDate) throw new HttpError(409, "먼저 시작일을 정해 주세요.");
    if (mask === before) return json({ ok: true, unchanged: true });
    const today = kstToday();
    let sched = null; // 시작 전이면 시작일부터 새 요일로
    if (today > startDate) {
      sched = JSON.stringify([...cur.filter((x) => x.date < today), { date: today, day: dayOnDate(cur, today).day, mask }]);
    }
    await env.DB.batch([
      ...(isPersonal(env)
        ? [env.DB.prepare("UPDATE members SET read_days = ?, sched = ? WHERE id = ?").bind(mask, sched, me.id)]
        : [setSetting(env, "read_days", mask), setSetting(env, "sched", sched)]),
      historyStmt(env, me, "read_days", null, String(before), String(mask)),
    ]);
    return json({ ok: true });
  }

  // 업데이트 소식 확인 (번호는 커지기만 한다). 개인용·모임용 소식 목록은 따로
  if (path === "/notices/seen" && method === "POST") {
    const id = Number((await readBody(request)).id);
    if (!Number.isInteger(id) || id < 0 || id > latestNotice(isPersonal(env))) throw new HttpError(400, "잘못된 요청이에요.");
    await env.DB.prepare("UPDATE members SET notice_seen = MAX(notice_seen, ?) WHERE id = ?").bind(id, me.id).run();
    return json({ ok: true });
  }

  // 의견·제보 보내기 / 내 제보 보기 (답변을 보면 '봤음'으로)
  if (path === "/feedback" && method === "POST") {
    const { kind, body, anonymous } = await readBody(request);
    const text = String(body || "").trim();
    if (!FEEDBACK_KINDS.includes(kind)) throw new HttpError(400, "종류를 골라 주세요.");
    if (!text || text.length > 2000) throw new HttpError(400, "내용은 1–2000자로 적어 주세요.");
    const since = new Date(Date.now() - 86400000).toISOString();
    const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback WHERE member_id = ? AND created_at >= ?").bind(me.id, since).first();
    if ((recent?.n || 0) >= 20) throw new HttpError(429, "오늘은 더 보낼 수 없어요. 내일 다시 보내 주세요.");
    await env.DB.prepare("INSERT INTO feedback (member_id, anonymous, kind, body, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind(me.id, anonymous ? 1 : 0, kind, text, nowIso()).run();
    return json({ ok: true });
  }
  if (path === "/feedback" && method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, anonymous, kind, body, status, reply, replied_at, reply_seen, created_at FROM feedback WHERE member_id = ? ORDER BY id DESC LIMIT 100",
    ).bind(me.id).all();
    await env.DB.prepare("UPDATE feedback SET reply_seen = 1 WHERE member_id = ? AND reply_seen = 0").bind(me.id).run();
    return json({ feedback: results.map(publicFeedback) });
  }

  // 함께 읽기: 한 사람의 밀린 장 자세히 (모임 모드 전용, 벌금 정산용)
  const memberMatch = path.match(/^\/members\/(\d+)$/);
  if (memberMatch && method === "GET" && !isPersonal(env)) {
    const id = Number(memberMatch[1]);
    const m = await env.DB.prepare("SELECT id, name, join_day FROM members WHERE id = ?").bind(id).first();
    if (!m) throw new HttpError(404, "그런 사람이 없어요.");
    const [plan, { sched }, checks] = await Promise.all([loadPlan(env, me), getSchedule(env, me), loadChecks(env, id)]);
    const p = progress(plan, sched, kstToday(), checks.get(id) || new Map(), m.join_day);
    return json({
      id: m.id, name: m.name, joinDay: m.join_day, doneDays: p.doneDays, total: p.total, streak: p.streak,
      missedDays: p.missed.length, missedChapters: p.missedChapters,
      months: sched ? missedByMonth(p.missedDetail, sched) : [],
      missed: p.missedDetail.map((x) => ({ ...x, date: dateOfDaySched(sched, x.day) })).reverse(),
    });
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
    if (h.kind === "read_days") throw new HttpError(409, "읽는 요일은 설정의 '요일 바꾸기'로 다시 골라 주세요.");
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
        ...setStartDateStmts(env, me, h.before_value),
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
      ...setStartDateStmts(env, me, start_date),
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
    if (!isPersonal(env) && body.chat_push !== undefined) {
      next.chat_push = body.chat_push ? 1 : 0;
      await env.DB.prepare("UPDATE members SET chat_push = ? WHERE id = ?").bind(next.chat_push, me.id).run();
    }
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

// ── 대화(단톡방) ───────────────────────────────────────
const REACTIONS = ["🙏", "❤️", "👍", "👏", "🙌", "😊", "😢", "🔥"]; // 공감 (화면과 서버가 같아야 함)
const MSG_COLS = `m.id, m.member_id, mem.name, m.kind, m.day,
  CASE WHEN m.deleted_at IS NULL THEN m.body ELSE '' END AS body, m.created_at, m.deleted_at IS NOT NULL AS deleted`;

async function attachReactions(env, rows) {
  if (!rows.length) return rows;
  const { results } = await env.DB.prepare(
    "SELECT message_id, member_id, emoji FROM reactions WHERE message_id IN (SELECT value FROM json_each(?))",
  ).bind(JSON.stringify(rows.map((r) => r.id))).all();
  const by = new Map();
  for (const r of results) {
    if (!by.has(r.message_id)) by.set(r.message_id, {});
    (by.get(r.message_id)[r.emoji] ||= []).push(r.member_id);
  }
  return rows.map((r) => ({ ...r, deleted: !!r.deleted, reactions: by.get(r.id) || {} }));
}

// 안 읽은 메시지 수 (다른 사람이 쓴 일반 메시지와 새 모임원 소식. 읽기 완료 소식은 세지 않음)
async function chatUnread(env, me) {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM messages WHERE id > ? AND member_id != ? AND kind IN ('text', 'join') AND deleted_at IS NULL",
  ).bind(me.last_read_msg || 0, me.id).first();
  return row?.n || 0;
}

// 오늘 분량을 다 체크한 순간 '읽기 완료' 소식 (한 사람당 하루 한 번, 지난 날 완료는 제외, 알림 없음)
async function postDoneIfToday(env, me, day) {
  const { sched } = await getSchedule(env, me);
  const on = sched && dayOnDate(sched, kstToday());
  if (!on || on.rest || on.day !== day) return false; // 쉬는 요일에 미리 읽은 것은 '오늘 완료'가 아님
  const row = await getDayRow(env, me, day);
  if (!row) return false;
  const chapters = JSON.parse(row.chapters);
  if (!chapters.length) return false;
  const { results } = await env.DB.prepare("SELECT chapter FROM checks WHERE member_id = ? AND day = ?").bind(me.id, day).all();
  const set = new Set(results.map((r) => r.chapter));
  if (!chapters.every((c) => set.has(chapterKey(c)))) return false;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO messages (member_id, kind, day, body, created_at) VALUES (?, 'done', ?, ?, ?)",
  ).bind(me.id, day, "오늘 말씀을 다 읽었어요 🎉", nowIso()).run();
  return true;
}

// 체크를 풀어 그날 분량이 다시 덜 읽은 상태가 되면 그날 '읽기 완료' 소식(과 공감)을 지운다 (다시 다 읽으면 다시 올라감)
async function removeDone(env, me, day) {
  const msg = await env.DB.prepare("SELECT id FROM messages WHERE member_id = ? AND kind = 'done' AND day = ?").bind(me.id, day).first();
  if (!msg) return false;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM reactions WHERE message_id = ?").bind(msg.id),
    env.DB.prepare("DELETE FROM messages WHERE id = ?").bind(msg.id),
  ]);
  return true;
}

// ── 의견·제보 ─────────────────────────────────────────
const FEEDBACK_KINDS = ["bug", "idea", "etc"];
const FEEDBACK_STATUS = ["new", "seen", "done", "closed"];
const publicFeedback = (r) => ({
  id: r.id, anonymous: !!r.anonymous, kind: r.kind, body: r.body, status: r.status,
  reply: r.reply, repliedAt: r.replied_at, replyNew: r.reply_seen === 0, createdAt: r.created_at,
});

// 관리자: 전체 제보 (익명이면 이름·사람 번호를 보내지 않음)
async function adminFeedbackList(request, env) {
  checkAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT f.*, m.name FROM feedback f LEFT JOIN members m ON m.id = f.member_id ORDER BY f.id DESC LIMIT 300`,
  ).all();
  return json({
    newCount: results.filter((r) => r.status === "new").length,
    feedback: results.map((r) => ({ ...publicFeedback(r), name: r.anonymous ? "익명" : (r.name || "(나간 사람)") })),
  });
}

// 관리자: 상태 바꾸기·답변 (답변하면 제보자에게 알림)
async function adminFeedbackUpdate(request, env, ctx, id) {
  checkAdmin(request, env);
  const row = await env.DB.prepare("SELECT * FROM feedback WHERE id = ?").bind(id).first();
  if (!row) throw new HttpError(404, "그런 제보가 없어요.");
  const { status, reply } = await readBody(request);
  if (status !== undefined && !FEEDBACK_STATUS.includes(status)) throw new HttpError(400, "잘못된 상태예요.");
  const text = reply === undefined ? null : String(reply).trim();
  if (text !== null && text.length > 2000) throw new HttpError(400, "답변은 2000자까지예요.");
  const nextStatus = status ?? (row.status === "new" ? "seen" : row.status);
  if (text) {
    await env.DB.prepare("UPDATE feedback SET status = ?, reply = ?, replied_at = ?, reply_seen = 0 WHERE id = ?")
      .bind(nextStatus, text, nowIso(), id).run();
    const job = pushToMember(env, row.member_id, {
      title: "💌 제보에 답변이 왔어요", body: text.length > 80 ? text.slice(0, 80) + "…" : text, url: "/?tab=settings", tag: "feedback",
    }).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  } else {
    await env.DB.prepare("UPDATE feedback SET status = ? WHERE id = ?").bind(nextStatus, id).run();
  }
  return json({ ok: true });
}

// 새 모임원 환영 인사 (대화방에 'join' 소식으로, 알림도 보냄)
const WELCOMES = [
  (n, d) => `${n}님이 모임에 함께하게 되었어요! 🎉 ${d} 같이 읽어요. 반갑게 맞아 주세요 🙏`,
  (n, d) => `새 식구 ${n}님을 환영해요! 👋 ${d} 말씀 여정을 함께 걸어요 📖`,
  (n, d) => `${n}님, 말씀 읽고 새 인생에 오신 걸 환영해요! 🌱 ${d} 한 장 한 장 함께 읽어요`,
];
async function welcomeMember(env, me, joinDay, started) {
  const when = started ? `DAY ${joinDay}부터` : "시작일부터";
  const text = WELCOMES[me.id % WELCOMES.length](me.name, when);
  await env.DB.prepare("INSERT INTO messages (member_id, kind, body, created_at) VALUES (?, 'join', ?, ?)")
    .bind(me.id, text, nowIso()).run();
  const { results } = await env.DB.prepare(
    `SELECT m.id FROM members m WHERE m.id != ? AND m.chat_push = 1
     AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = m.id)`,
  ).bind(me.id).all();
  for (const m of results) {
    await pushToMember(env, m.id, { title: "👋 새 모임원", body: `${me.name}님이 들어왔어요. 환영해 주세요!`, url: "/?tab=chat", tag: "chat" }).catch(() => {});
  }
}

async function notifyChat(env, me, text) {
  const { results } = await env.DB.prepare(
    `SELECT m.id FROM members m WHERE m.id != ? AND m.chat_push = 1
     AND EXISTS (SELECT 1 FROM push_subscriptions s WHERE s.member_id = m.id)`,
  ).bind(me.id).all();
  const body = text.length > 80 ? text.slice(0, 80) + "…" : text;
  for (const m of results) {
    await pushToMember(env, m.id, { title: `💬 ${me.name}`, body, url: "/?tab=chat", tag: "chat" }).catch(() => {});
  }
}

async function handleChat(request, env, ctx, me, path, method, url) {
  // 불러오기: 처음엔 최근 100개, before=ID 면 그 이전 100개, after=ID 면 새 메시지 + from 이후 메시지의 공감·삭제 변화
  if (path === "/chat" && method === "GET") {
    const after = Number(url.searchParams.get("after") || 0);
    const before = Number(url.searchParams.get("before") || 0);
    const base = `SELECT ${MSG_COLS} FROM messages m LEFT JOIN members mem ON mem.id = m.member_id`;
    let rows;
    let updates = [];
    if (after) {
      rows = (await env.DB.prepare(`${base} WHERE m.id > ? ORDER BY m.id LIMIT 200`).bind(after).all()).results;
      const from = Number(url.searchParams.get("from") || after);
      updates = (await env.DB.prepare(`${base} WHERE m.id >= ? AND m.id <= ? ORDER BY m.id`).bind(from, after).all()).results;
    } else if (before) {
      rows = (await env.DB.prepare(`${base} WHERE m.id < ? ORDER BY m.id DESC LIMIT 100`).bind(before).all()).results.reverse();
    } else {
      rows = (await env.DB.prepare(`${base} ORDER BY m.id DESC LIMIT 100`).all()).results.reverse();
    }
    const { results: reads } = await env.DB.prepare("SELECT id, last_read_msg AS last_read FROM members").all();
    return json({ messages: await attachReactions(env, rows), updates: await attachReactions(env, updates), reads });
  }

  if (path === "/chat" && method === "POST") {
    const { body } = await readBody(request);
    const text = String(body || "").replace(/\r\n/g, "\n").trim();
    if (!text) throw new HttpError(400, "메시지를 적어 주세요.");
    if (text.length > 1000) throw new HttpError(400, "메시지는 1,000자까지 보낼 수 있어요.");
    const created = nowIso();
    await env.DB.prepare("INSERT INTO messages (member_id, kind, body, created_at) VALUES (?, 'text', ?, ?)")
      .bind(me.id, text, created).run();
    const row = await env.DB.prepare(`SELECT ${MSG_COLS} FROM messages m LEFT JOIN members mem ON mem.id = m.member_id
      WHERE m.member_id = ? AND m.created_at = ? ORDER BY m.id DESC LIMIT 1`).bind(me.id, created).first();
    await env.DB.prepare("UPDATE members SET last_read_msg = MAX(last_read_msg, ?) WHERE id = ?").bind(row.id, me.id).run();
    signalChat(env, ctx);
    const job = notifyChat(env, me, text);
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
    return json({ message: (await attachReactions(env, [row]))[0] });
  }

  if (path === "/chat/read" && method === "POST") {
    const { id } = await readBody(request);
    if (!Number.isInteger(id)) throw new HttpError(400, "잘못된 요청이에요.");
    if (id > (me.last_read_msg || 0)) {
      await env.DB.prepare("UPDATE members SET last_read_msg = MAX(last_read_msg, ?) WHERE id = ?").bind(id, me.id).run();
      signalChat(env, ctx);
    }
    return json({ ok: true });
  }

  const reactMatch = path.match(/^\/chat\/(\d+)\/react$/);
  if (reactMatch && method === "POST") {
    const id = Number(reactMatch[1]);
    const { emoji } = await readBody(request);
    if (!REACTIONS.includes(emoji)) throw new HttpError(400, `공감은 ${REACTIONS.join(" ")} 중에서 골라 주세요.`);
    const msg = await env.DB.prepare("SELECT deleted_at FROM messages WHERE id = ?").bind(id).first();
    if (!msg || msg.deleted_at) throw new HttpError(404, "메시지를 찾지 못했어요.");
    const had = await env.DB.prepare("SELECT 1 FROM reactions WHERE message_id = ? AND member_id = ? AND emoji = ?").bind(id, me.id, emoji).first();
    await (had
      ? env.DB.prepare("DELETE FROM reactions WHERE message_id = ? AND member_id = ? AND emoji = ?").bind(id, me.id, emoji)
      : env.DB.prepare("INSERT INTO reactions (message_id, member_id, emoji) VALUES (?, ?, ?)").bind(id, me.id, emoji)).run();
    signalChat(env, ctx);
    return json({ ok: true, on: !had });
  }

  const delMatch = path.match(/^\/chat\/(\d+)$/);
  if (delMatch && method === "DELETE") {
    const id = Number(delMatch[1]);
    const msg = await env.DB.prepare("SELECT member_id, kind FROM messages WHERE id = ?").bind(id).first();
    if (!msg) throw new HttpError(404, "메시지를 찾지 못했어요.");
    if (msg.member_id !== me.id || msg.kind !== "text") throw new HttpError(403, "내가 쓴 메시지만 지울 수 있어요.");
    await env.DB.batch([
      env.DB.prepare("UPDATE messages SET body = '', deleted_at = ? WHERE id = ?").bind(nowIso(), id),
      env.DB.prepare("DELETE FROM reactions WHERE message_id = ?").bind(id),
    ]);
    signalChat(env, ctx);
    return json({ ok: true });
  }

  throw new HttpError(404, "없는 요청이에요.");
}

// 모임 모드 입장 (초대 코드 + 이름). 같은 이름이 있으면 그 사람으로 이어서 사용
async function joinGroup(request, env, ctx) {
  const { name, invite } = await readBody(request);
  if (!env.INVITE_CODE || String(invite || "").trim() !== env.INVITE_CODE) {
    throw new HttpError(403, "초대 코드가 맞지 않아요.");
  }
  const n = cleanName(name);
  let me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
  if (!me) {
    // 모임이 이미 시작했으면 오늘 DAY 부터 참여 (그 전 날은 밀린 장·벌금에서 빠짐)
    const { sched } = await getSchedule(env, null);
    const joinDay = sched ? Math.max(1, dayOnDate(sched, kstToday()).day) : 1;
    await env.DB.prepare("INSERT INTO members (name, token, created_at, notice_seen, join_day) VALUES (?, ?, ?, ?, ?)")
      .bind(n, newToken(), nowIso(), latestNotice(false), joinDay).run(); // 새 사람은 지난 소식 표시 없이
    me = await env.DB.prepare("SELECT * FROM members WHERE name = ?").bind(n).first();
    const job = welcomeMember(env, me, joinDay, !!sched).then(() => signalChat(env, ctx)).catch((e) => console.error("welcome", e));
    if (ctx?.waitUntil) ctx.waitUntil(job); else await job;
  }
  return json({ token: me.token, member: publicMember(me) });
}

// 개인 모드 시작 (이름 + 시작일). 기본 읽기표를 복사해 나만의 읽기표를 만든다.
async function joinPersonal(request, env) {
  const body = await readBody(request);
  const n = cleanName(body.name);
  // roadmap·per_day 가 없으면(예전 화면) 예수님에서 시작하는 통독 · 하루 3장
  const { roadmap, perDay, startDate: start_date, readDays } = checkPlanChoice(body);
  const token = newToken();
  const now = nowIso();
  const appNow = request.headers.get("X-App-Mode") === "standalone" ? now : null; // 앱에서 시작했으면 앱 기록도
  for (let attempt = 0; ; attempt++) {
    try {
      await env.DB.prepare(
        `INSERT INTO members (name, token, recovery_code, start_date, roadmap, per_day, read_days, notice_seen, created_at, last_seen_at, app_first_at, app_last_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(n, token, newRecoveryCode(), start_date, roadmap, perDay, readDays, latestNotice(true), now, now, appNow, appNow).run(); // 새 사람은 지난 소식 표시 없이
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
  } else if (h.kind === "read_days") {
    summary = `읽는 요일: ${weekdaysText(Number(h.before_value))} → ${weekdaysText(Number(h.after_value))}`;
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
  const shared = isPersonal(env) ? null : { plan: await loadPlan(env, null), sched: (await getSchedule(env, null)).sched };
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
    const sched = shared ? shared.sched : memberSched(m);
    if (!sched) continue;
    const prog = progress(plan, sched, today, checks.get(m.id) || new Map(), m.join_day ?? 1);
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
