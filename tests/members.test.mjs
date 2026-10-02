// 함께 읽기: 사람별 밀린 장 (벌금 정산용) 검사
import { test } from "node:test";
import assert from "node:assert/strict";
import { missedByMonth, progress } from "../worker/logic.js";
import { kstToday } from "../public/shared/bible.js";
import worker from "../worker/index.js";
import { createLocalDB } from "../scripts/d1-local.mjs";

const plan = [
  { day: 1, chapters: [["누가복음", 1], ["누가복음", 2], ["누가복음", 3]] },
  { day: 2, chapters: [["누가복음", 4], ["누가복음", 5], ["누가복음", 6]] },
  { day: 3, chapters: [["누가복음", 7], ["누가복음", 8], ["누가복음", 9]] },
  { day: 4, chapters: [["누가복음", 10], ["누가복음", 11], ["누가복음", 12]] },
];

test("밀린 장: 어제 이전 날짜에서 아직 체크 안 한 장만, 오늘은 제외", () => {
  // 9/29 시작 → 10/2 가 오늘(DAY 4). DAY 1 은 다 읽음, DAY 2 는 한 장만, DAY 3 은 안 읽음
  const checked = new Map([
    [1, new Set(["누가복음 1", "누가복음 2", "누가복음 3"])],
    [2, new Set(["누가복음 4"])],
  ]);
  const p = progress(plan, "2026-09-29", "2026-10-02", checked);
  assert.deepEqual(p.missed, [2, 3]);
  assert.equal(p.missedChapters, 5);
  assert.deepEqual(p.missedDetail[0], { day: 2, remaining: [["누가복음", 5], ["누가복음", 6]] });
  // DAY 2 = 9/30, DAY 3 = 10/1 → 달별로 나뉨, 최근 달 먼저
  assert.deepEqual(missedByMonth(p.missedDetail, "2026-09-29"), [
    { month: "2026-10", chapters: 3, days: 1 },
    { month: "2026-09", chapters: 2, days: 1 },
  ]);
});

function makeApp(mode) {
  const env = { DB: createLocalDB({ mode }), ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ...(mode === "personal" ? { MODE: "personal" } : {}) };
  return async (path, { method = "GET", body, token } = {}) => {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test("모임 모드: 다른 사람의 밀린 장을 서로 볼 수 있다", async () => {
  const call = makeApp("group");
  const a = (await call("/api/join", { method: "POST", body: { name: "가", invite: "test" } })).data;
  const b = (await call("/api/join", { method: "POST", body: { name: "나", invite: "test" } })).data;
  // 3일 전 시작 → 오늘이 DAY 4, 밀릴 수 있는 날은 DAY 1–3
  const start = new Date(Date.parse(kstToday() + "T00:00:00Z") - 3 * 86400000).toISOString().slice(0, 10);
  await call("/api/settings", { method: "PUT", token: a.token, body: { start_date: start } });
  for (const c of [1, 2, 3, 4]) await call("/api/check", { method: "POST", token: b.token, body: { day: c <= 3 ? 1 : 2, chapter: `누가복음 ${c}`, checked: true } });

  const list = (await call("/api/members", { token: a.token })).data.members;
  const nb = list.find((m) => m.name === "나");
  assert.equal(nb.missedDays, 2); // DAY 2(한 장만 읽음), DAY 3
  assert.equal(nb.missedChapters, 5);
  assert.equal(list.find((m) => m.name === "가").missedChapters, 9);

  // '가'가 '나'의 자세한 내용을 본다
  const detail = (await call(`/api/members/${b.member.id}`, { token: a.token })).data;
  assert.equal(detail.name, "나");
  assert.equal(detail.missedChapters, 5);
  assert.deepEqual(detail.missed.map((x) => x.day), [3, 2]); // 최근 날짜 먼저
  assert.deepEqual(detail.missed[1].remaining, [["누가복음", 5], ["누가복음", 6]]);
  assert.equal(detail.months.reduce((n, m) => n + m.chapters, 0), 5);
  assert.equal((await call("/api/members/999", { token: a.token })).status, 404);
});

test("개인 모드에는 다른 사람 보기가 없다", async () => {
  const call = makeApp("personal");
  const t = (await call("/api/join", { method: "POST", body: { name: "혼자", start_date: "2026-10-01" } })).data;
  assert.equal((await call(`/api/members/${t.member.id}`, { token: t.token })).status, 404);
});
