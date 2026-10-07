// 개인 모드: 못 읽은 날 처리 — 패스(skip) / 이어 읽기(flow)
import { test } from "node:test";
import assert from "node:assert/strict";
import { flowDay, kstToday } from "../public/shared/bible.js";
import { buildMessage, progress } from "../worker/logic.js";
import worker from "../worker/index.js";
import { createLocalDB, personalMigrations } from "../scripts/d1-local.mjs";

const plan = Array.from({ length: 10 }, (_, i) => ({ day: i + 1, chapters: [["누가복음", i + 1]] }));
const checkedDays = (days) => new Map(days.map((d) => [d, new Set([`누가복음 ${d}`])]));

test("이어 읽기: 못 읽은 첫 날부터, 밀린 날 없음, 늦어진 날 수", () => {
  const p = progress(plan, "2026-10-01", "2026-10-05", checkedDays([1, 2]), 1, "flow"); // 날짜로는 DAY 5
  assert.equal(p.todayDay, 3);
  assert.equal(p.lag, 2);
  assert.deepEqual(p.missed, []);
  assert.match(buildMessage("morning", p).body, /예정보다 2일 늦어요/);
  // 미리 읽어도 날짜 기준을 넘지 않음
  const ahead = progress(plan, "2026-10-01", "2026-10-03", checkedDays([1, 2, 3, 4, 5]), 1, "flow");
  assert.equal(ahead.todayDay, 3);
  assert.equal(ahead.lag, 0);
  // 패스는 지금과 같음
  const skip = progress(plan, "2026-10-01", "2026-10-05", checkedDays([1, 2]), 1, "skip");
  assert.equal(skip.todayDay, 5);
  assert.deepEqual(skip.missed, [3, 4]);
  assert.equal(skip.lag, 0);
  assert.equal(flowDay(0, 10, () => false), 0); // 시작 전
  // 쉬는 요일은 그대로 쉬는 날
  const sched = [{ date: "2026-10-05", day: 1, mask: 126 }]; // 일요일 쉼
  const sun = progress(plan, sched, "2026-10-11", checkedDays([1, 2, 3]), 1, "flow");
  assert.equal(sun.rest, true);
  assert.equal(sun.todayDay, 4);
  assert.equal(buildMessage("morning", sun), null);
});

function makeApp(DB = createLocalDB({ mode: "personal" })) {
  const env = { DB, ASSETS: { fetch: () => new Response("") }, MODE: "personal" };
  return async (path, { method = "GET", body, token } = {}) => {
    const res = await worker.fetch(new Request("https://app.test/api" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test("이어 읽기 API: 고르기·바꾸기·달력형은 패스만", async () => {
  const call = makeApp();
  const join = (body) => call("/join", { method: "POST", body: { name: "가", start_date: kstToday(), ...body } });
  const t = (await join({ catch_up: "flow" })).data.token;
  let s = (await call("/state", { token: t })).data;
  assert.equal(s.catchUp, "flow");
  assert.equal(s.catchUpAsked, true); // 새로 시작한 사람은 안내 팝업 없음
  assert.equal((await call("/catch-up", { method: "PUT", token: t, body: { mode: "zzz" } })).status, 400);
  await call("/catch-up", { method: "PUT", token: t, body: { mode: "skip" } });
  assert.equal((await call("/state", { token: t })).data.catchUp, "skip");
  assert.match((await call("/history", { token: t })).data.history[0].summary, /못 읽은 날: 이어 읽기 → 패스/);
  const c = (await join({ roadmap: "mcheyne", catch_up: "flow" })).data.token;
  assert.equal((await call("/state", { token: c })).data.catchUp, "skip");
  assert.equal((await call("/catch-up", { method: "PUT", token: c, body: { mode: "flow" } })).status, 400);
});

test("기존 개인 DB 에 0005 적용: 패스 그대로, 안내 팝업 대상", async () => {
  const DB = createLocalDB({ mode: "personal", migrate: false });
  const ms = personalMigrations();
  for (const sql of ms.slice(0, 4)) DB.exec(sql);
  await DB.prepare("INSERT INTO members (name, token, recovery_code, start_date, created_at) VALUES ('옛사람', 'tok', 'AAAA-BBBB', '2026-09-30', 'x')").run();
  await DB.prepare("INSERT INTO member_plan (member_id, day, chapters) SELECT 1, day, chapters FROM plan_days").run();
  for (const sql of ms.slice(4)) DB.exec(sql);
  const call = makeApp(DB);
  const s = (await call("/state", { token: "tok" })).data;
  assert.equal(s.catchUp, "skip");
  assert.equal(s.catchUpAsked, false);
  await call("/catch-up/asked", { method: "POST", token: "tok" });
  assert.equal((await call("/state", { token: "tok" })).data.catchUpAsked, true);
});
