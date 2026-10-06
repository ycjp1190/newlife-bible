// 개인 모드: 읽는 요일 선택 · 업데이트 소식 검사
import { test } from "node:test";
import assert from "node:assert/strict";
import { dateOfDay, dateOfDaySched, dayIndex, dayOnDate, kstToday, weekdaysText } from "../public/shared/bible.js";
import { LATEST_NOTICE, latestNotice } from "../public/shared/notices.js";
import { buildMessage, progress } from "../worker/logic.js";
import worker from "../worker/index.js";
import { createLocalDB, personalMigrations } from "../scripts/d1-local.mjs";

const NO_SUN = 127 - 1; // 월–토
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);

function makeApp(DB = createLocalDB({ mode: "personal" })) {
  const env = { DB, ASSETS: { fetch: () => new Response("") }, MODE: "personal" };
  return async (path, { method = "GET", body, token } = {}) => {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test("일정 계산: 매일이면 기존 계산과 같고, 쉬는 요일은 건너뛴다", () => {
  for (let i = -3; i < 800; i++) {
    const date = dateOfDay("2026-02-27", i);
    assert.equal(dayOnDate("2026-02-27", date).day, dayIndex("2026-02-27", date));
    if (i >= 1) assert.equal(dateOfDaySched("2026-02-27", i), date);
  }
  // 2026-10-05 월요일 시작, 일요일 쉼
  const s = [{ date: "2026-10-05", day: 1, mask: NO_SUN }];
  assert.deepEqual(dayOnDate(s, "2026-10-10"), { day: 6, rest: false }); // 토
  assert.deepEqual(dayOnDate(s, "2026-10-11"), { day: 7, rest: true }); // 일 → 다음 읽기 DAY 7
  assert.deepEqual(dayOnDate(s, "2026-10-12"), { day: 7, rest: false }); // 월
  assert.equal(dateOfDaySched(s, 7), "2026-10-12");
  assert.equal(dateOfDaySched(s, 397), "2028-01-10"); // 396일 = 66주(462일) 뒤 첫 읽는 날
  for (let d = 1; d < 400; d++) assert.equal(dayOnDate(s, dateOfDaySched(s, d)).day, d);
  assert.equal(weekdaysText(NO_SUN), "월–토");
  assert.equal(weekdaysText(127), "매일");
  assert.equal(weekdaysText(127 - 64), "월–금·일");
});

test("일정 계산: 도중에 요일을 바꿔도 지난 DAY 의 날짜는 그대로", () => {
  const s = [{ date: "2026-10-01", day: 1, mask: 127 }, { date: "2026-10-11", day: 11, mask: NO_SUN }];
  for (let d = 1; d <= 10; d++) assert.equal(dateOfDaySched(s, d), dateOfDay("2026-10-01", d));
  assert.deepEqual(dayOnDate(s, "2026-10-11"), { day: 11, rest: true }); // 10-11 일요일
  assert.equal(dateOfDaySched(s, 11), "2026-10-12");
});

test("쉬는 요일: 밀린 날로 세지 않고 알림도 없다", () => {
  const s = [{ date: "2026-10-05", day: 1, mask: NO_SUN }];
  const plan = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, chapters: [["누가복음", i + 1]] }));
  const checked = new Map(Array.from({ length: 6 }, (_, i) => [i + 1, new Set([`누가복음 ${i + 1}`])]));
  const sun = progress(plan, s, "2026-10-11", checked);
  assert.equal(sun.rest, true);
  assert.equal(sun.todayDay, 7);
  assert.deepEqual(sun.missed, []);
  assert.equal(sun.streak, 6);
  assert.equal(buildMessage("morning", sun), null);
  const mon = progress(plan, s, "2026-10-12", checked);
  assert.equal(mon.rest, false);
  assert.ok(buildMessage("morning", mon).title.includes("DAY 7"));
  // 모임 모드처럼 시작일 문자열이면 지금과 같은 매일 계산
  assert.equal(progress(plan, "2026-10-05", "2026-10-11", checked).todayDay, 7);
});

test("시작할 때 요일 고르기: 6일 미만은 안 되고, 달력형은 매일", async () => {
  const call = makeApp();
  const join = (body) => call("/api/join", { method: "POST", body: { name: "가", start_date: "2026-10-05", ...body } });
  assert.equal((await join({ read_days: 127 - 1 - 64 })).status, 400); // 5일
  const t = (await join({ read_days: NO_SUN })).data.token;
  const s = (await call("/api/state", { token: t })).data;
  assert.equal(s.readDays, NO_SUN);
  assert.deepEqual(s.sched, [{ date: "2026-10-05", day: 1, mask: NO_SUN }]);
  const c = (await join({ roadmap: "community", read_days: NO_SUN })).data.token;
  const cs = (await call("/api/state", { token: c })).data;
  assert.equal(cs.readDays, 127);
  assert.equal((await call("/api/read-days", { method: "PUT", token: c, body: { mask: NO_SUN } })).status, 403);
});

test("요일 바꾸기: 오늘부터 적용, 지난 날·체크는 그대로, 기록에 남음", async () => {
  const call = makeApp();
  const today = kstToday();
  const start = addDays(today, -10);
  const t = (await call("/api/join", { method: "POST", body: { name: "나", start_date: start } })).data.token;
  await call("/api/check", { method: "POST", token: t, body: { day: 1, chapter: "누가복음 1", checked: true } });
  assert.equal((await call("/api/read-days", { method: "PUT", token: t, body: { mask: 7 } })).status, 400);
  // 오늘 요일을 쉬는 날로
  const todayBit = 1 << new Date(today + "T00:00:00Z").getUTCDay();
  const mask = 127 - todayBit;
  assert.equal((await call("/api/read-days", { method: "PUT", token: t, body: { mask } })).status, 200);
  const s = (await call("/api/state", { token: t })).data;
  assert.equal(s.readDays, mask);
  assert.deepEqual(s.sched, [{ date: start, day: 1, mask: 127 }, { date: today, day: 11, mask }]);
  const on = dayOnDate(s.sched, today);
  assert.deepEqual(on, { day: 11, rest: true });
  assert.equal(dateOfDaySched(s.sched, 10), addDays(today, -1));
  assert.deepEqual(s.checks, { 1: ["누가복음 1"] });
  const { history } = (await call("/api/history", { token: t })).data;
  assert.match(history[0].summary, /읽는 요일: 매일 →/);
  assert.equal((await call(`/api/history/${history[0].id}/revert`, { method: "POST", token: t })).status, 409);
  // 같은 날 다시 바꾸면 오늘 구간만 바뀐다
  await call("/api/read-days", { method: "PUT", token: t, body: { mask: 127 } });
  assert.deepEqual((await call("/api/state", { token: t })).data.sched, [{ date: start, day: 1, mask: 127 }, { date: today, day: 11, mask: 127 }]);
  // 시작일을 바꾸면 구간 기록은 비우고 지금 요일로
  await call("/api/read-days", { method: "PUT", token: t, body: { mask: NO_SUN } });
  await call("/api/settings", { method: "PUT", token: t, body: { start_date: addDays(today, 3) } });
  assert.deepEqual((await call("/api/state", { token: t })).data.sched, [{ date: addDays(today, 3), day: 1, mask: NO_SUN }]);
});

test("업데이트 소식: 새 사람은 이미 본 것으로, 확인 번호는 커지기만", async () => {
  const call = makeApp();
  const t = (await call("/api/join", { method: "POST", body: { name: "다", start_date: "2026-10-05" } })).data.token;
  assert.equal((await call("/api/state", { token: t })).data.noticeSeen, LATEST_NOTICE);
  assert.equal((await call("/api/notices/seen", { method: "POST", token: t, body: { id: LATEST_NOTICE + 1 } })).status, 400);
  await call("/api/notices/seen", { method: "POST", token: t, body: { id: 0 } });
  assert.equal((await call("/api/state", { token: t })).data.noticeSeen, LATEST_NOTICE);
});

test("기존 개인 DB 에 0003 적용: 매일 읽기 그대로, 소식은 안 본 상태", async () => {
  const DB = createLocalDB({ mode: "personal", migrate: false });
  const [m1, m2, m3, ...later] = personalMigrations();
  DB.exec(m1);
  DB.exec(m2);
  await DB.prepare("INSERT INTO members (name, token, recovery_code, start_date, created_at) VALUES ('옛사람', 'tok', 'AAAA-BBBB', '2026-09-30', 'x')").run();
  await DB.prepare("INSERT INTO member_plan (member_id, day, chapters) SELECT 1, day, chapters FROM plan_days").run();
  await DB.prepare("INSERT INTO checks (member_id, plan_version, day, chapter, checked_at) VALUES (1, 0, 1, '누가복음 1', 'x')").run();
  DB.exec(m3);
  for (const sql of later) DB.exec(sql); // 이후 변경 파일(제보 표 등)
  const call = makeApp(DB);
  const s = (await call("/api/state", { token: "tok" })).data;
  assert.equal(s.readDays, 127);
  assert.deepEqual(s.sched, [{ date: "2026-09-30", day: 1, mask: 127 }]);
  assert.equal(s.noticeSeen, 0);
  assert.equal(s.plan.length, 397);
  assert.deepEqual(s.checks, { 1: ["누가복음 1"] });
  await call("/api/notices/seen", { method: "POST", token: "tok", body: { id: LATEST_NOTICE } });
  assert.equal((await call("/api/state", { token: "tok" })).data.noticeSeen, LATEST_NOTICE);
});

test("모임 모드: 읽는 요일은 모두 공통, 소식 확인은 사람마다", async () => {
  const DB = createLocalDB({ mode: "group" });
  const env = { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test" };
  const go = async (path, { method = "GET", body, token } = {}) => {
    const res = await worker.fetch(new Request("https://g.test/api" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const join = async (name) => (await go("/join", { method: "POST", body: { name, invite: "test" } })).data.token;
  const a = await join("가");
  const b = await join("나");
  // 시작일 전에는 요일을 바꿀 수 없음
  assert.equal((await go("/read-days", { method: "PUT", token: a, body: { mask: NO_SUN } })).status, 409);
  const today = kstToday();
  const start = addDays(today, -10);
  await go("/settings", { method: "PUT", token: a, body: { start_date: start } });
  assert.equal((await go("/read-days", { method: "PUT", token: a, body: { mask: 7 } })).status, 400);
  const todayBit = 1 << new Date(today + "T00:00:00Z").getUTCDay();
  assert.equal((await go("/read-days", { method: "PUT", token: a, body: { mask: 127 - todayBit } })).status, 200);
  // 나(b)에게도 같이 적용
  const sb = (await go("/state", { token: b })).data;
  assert.equal(sb.readDays, 127 - todayBit);
  assert.deepEqual(sb.sched, [{ date: start, day: 1, mask: 127 }, { date: today, day: 11, mask: 127 - todayBit }]);
  const { history } = (await go("/history", { token: b })).data;
  assert.match(history[0].summary, /읽는 요일: 매일 →/);
  // 함께 탭: 오늘은 쉬는 날 → DAY 1~10 만 밀린 날
  const me = (await go("/members", { token: a })).data.members.find((m) => m.name === "나");
  assert.equal(me.missedDays, 10);
  // 쉬는 날에 다음 분량을 다 읽어도 '오늘 완료' 소식은 없음
  for (const c of [28, 29, 30]) await go("/check", { method: "POST", token: a, body: { day: 11, chapter: `누가복음 ${c}`, checked: true } });
  assert.equal((await go("/chat", { token: a })).data.messages.filter((m) => m.kind === "done").length, 0);
  // 시작일을 바꾸면 요일 구간 기록은 비우고 지금 요일로
  await go("/settings", { method: "PUT", token: a, body: { start_date: addDays(today, 2) } });
  assert.deepEqual((await go("/state", { token: b })).data.sched, [{ date: addDays(today, 2), day: 1, mask: 127 - todayBit }]);
  // 소식: 새로 들어온 사람은 최신 번호, 다시 입장해도 그대로, 확인은 커지기만
  const latest = latestNotice(false);
  assert.equal((await go("/state", { token: a })).data.noticeSeen, latest);
  await DB.prepare("UPDATE members SET notice_seen = 0 WHERE name = '가'").run();
  await join("가");
  assert.equal((await go("/state", { token: a })).data.noticeSeen, 0);
  assert.equal((await go("/notices/seen", { method: "POST", token: a, body: { id: latest + 1 } })).status, 400);
  await go("/notices/seen", { method: "POST", token: a, body: { id: latest } });
  assert.equal((await go("/state", { token: a })).data.noticeSeen, latest);
});
