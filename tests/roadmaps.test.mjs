// 로드맵·맥체인 읽기표 검사, 개인 모드 계획 선택 API, 기존 사용자 DB 변경(migration) 검사
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOKS, buildDefaultPlan, chapterKey, formatChapters, itemLabel } from "../public/shared/bible.js";
import { buildPlan, chapterSequence, dayOfYear, daysNeeded, readingsOn, sectionLabel, videoOn, yearLength } from "../public/shared/roadmaps.js";
import { COMMUNITY } from "../public/shared/community.js";
import { MCHEYNE } from "../public/shared/mcheyne.js";
import worker from "../worker/index.js";
import { createLocalDB, personalMigrations } from "../scripts/d1-local.mjs";

test("순서형 로드맵 3개: 1,189장을 정확히 한 번씩", () => {
  const all = Object.entries(BOOKS).flatMap(([b, { chapters }]) => Array.from({ length: chapters }, (_, i) => `${b} ${i + 1}`)).sort();
  for (const id of ["flow397", "gospelA", "chrono"]) {
    const keys = chapterSequence(id).map((s) => chapterKey(s.item));
    assert.equal(keys.length, 1189, id);
    assert.deepEqual([...keys].sort(), all, id);
  }
  // 성경통독 로드맵 순서 확인: A 는 마가복음으로 시작해 요한계시록으로, 시간 순서는 「어? 성경이 읽어지네!」 순서
  assert.equal(chapterKey(chapterSequence("gospelA")[0].item), "마가복음 1");
  assert.equal(chapterKey(chapterSequence("gospelA")[16].item), "창세기 1");
  const chrono = chapterSequence("chrono").map((s) => chapterKey(s.item));
  assert.equal(chrono[0], "창세기 1");
  assert.ok(chrono.indexOf("민수기 36") < chrono.indexOf("레위기 1")); // 교재대로 민수기 다음 레위기
  assert.ok(chrono.indexOf("시편 59") < chrono.indexOf("사무엘상 21")); // 시편은 다윗의 사건 자리에
  assert.ok(chrono.indexOf("말라기 4") < chrono.indexOf("욥기 1")); // 욥기는 구약 끝
  assert.equal(chrono.indexOf("누가복음 1") + 2, chrono.indexOf("마태복음 1")); // 복음서는 사건 순서로 엮음
  for (let c = 1; c < 28; c++) assert.ok(chrono.indexOf(`사도행전 ${c}`) < chrono.indexOf(`사도행전 ${c + 1}`)); // 행 9:32-11:18 이 먼저여도 장 순서 유지
  assert.equal(chapterKey(chapterSequence("chrono").at(-1).item), "요한계시록 22");
});

test("예수님에서 시작하는 통독 · 하루 3장 = 기존 397일 표 그대로 (모임용 보호)", () => {
  assert.deepEqual(buildPlan("flow397", 3), buildDefaultPlan(3));
  assert.equal(sectionLabel("flow397", buildDefaultPlan(3)[17].chapters), "01 · 예수님에게서 시작하다");
});

test("하루 분량별 일수", () => {
  for (const [n, days] of [[1, 1189], [2, 595], [3, 397], [4, 298], [5, 238], [7, 170], [10, 119]]) {
    assert.equal(daysNeeded("chrono", n), days);
    assert.equal(buildPlan("chrono", n).length, days);
  }
  assert.equal(sectionLabel("gospelA", buildPlan("gospelA", 3)[0].chapters), "구간 1 · 율법과 완성");
});

test("맥체인: 날짜별 4곳, 윤년 2월 29일, 절 단위 표시", () => {
  assert.equal(Object.keys(MCHEYNE).length, 366);
  assert.ok(Object.values(MCHEYNE).every((d) => d.length === 4));
  const plan = buildPlan("mcheyne", 4, "2028-02-28");
  assert.equal(plan.length, 366);
  assert.deepEqual(plan[1].chapters, MCHEYNE["02-29"]);
  assert.equal(buildPlan("mcheyne", 4, "2026-10-01").length, 365);
  assert.equal(yearLength("2027-03-01"), 366);
  const mar1 = MCHEYNE["03-01"];
  assert.equal(itemLabel(mar1[0]), "출애굽기 12:29–51");
  assert.equal(formatChapters(mar1), "출애굽기 12:29–51 · 누가복음 15장 · 욥기 30장 · 고린도전서 16장");
  assert.equal(sectionLabel("mcheyne", mar1), "맥체인 성경읽기");
});

test("333 공동체성경읽기: 1월 1일 = 1일차, 장마다 체크, 영상, 윤년", () => {
  assert.equal(COMMUNITY.length, 365);
  assert.deepEqual(readingsOn("community", "2026-01-01"), [["창세기", 1], ["창세기", 2], ["시편", 1]]);
  // 영상 제목의 날짜와 일치: 24년 7월 31일 = 213일차 (윤년)
  assert.equal(dayOfYear("2024-07-31"), 213);
  assert.deepEqual(readingsOn("community", "2024-07-31"), COMMUNITY[212].chapters);
  assert.equal(itemLabel(COMMUNITY[118].chapters.at(-1)), "시편 119:1–32");
  // 제목 오류 보정 확인
  assert.deepEqual(COMMUNITY[81].chapters, [["여호수아", 23], ["여호수아", 24], ["시편", 82]]);
  assert.deepEqual(COMMUNITY[245].chapters, [["에스겔", 25], ["에스겔", 26], ["에스겔", 27], ["시편", 91]]);
  assert.equal(COMMUNITY[245].video, "");
  assert.equal(itemLabel(COMMUNITY[278].chapters.at(-1)), "시편 119:153–176");
  assert.ok(COMMUNITY[348].chapters.some(([b]) => b === "빌레몬서"));
  // 윤년 12월 31일(366번째 날)은 본문 없음 = 밀린 읽기 하는 날
  assert.deepEqual(readingsOn("community", "2028-12-31"), []);
  // 오늘 시작해도 오늘 날짜 본문부터
  const plan = buildPlan("community", 3, "2026-10-02");
  assert.equal(plan.length, 365);
  assert.deepEqual(plan[0].chapters, COMMUNITY[274].chapters);
  assert.equal(sectionLabel("community", plan[0].chapters), "333 · 공동체성경읽기");
  assert.match(videoOn("community", "2026-10-02"), /watch\?v=a0iMFYO4faY&list=/);
  assert.equal(videoOn("community", "2025-09-03"), null); // 246일차는 영상 없음
  assert.equal(videoOn("flow397", "2026-10-02"), null);
});

// ── 개인 모드 API ──
function makeApp(DB) {
  const env = { DB, ASSETS: { fetch: () => new Response("") }, MODE: "personal" };
  return async function call(path, { method = "GET", body, token } = {}) {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const join = async (call, body) => (await call("/api/join", { method: "POST", body: { name: "나", start_date: "2026-10-01", ...body } })).data.token;

test("개인 모드: 로드맵·분량을 골라 시작", async () => {
  const call = makeApp(createLocalDB({ mode: "personal" }));
  const t1 = await join(call, { roadmap: "chrono", per_day: 5 });
  const s1 = (await call("/api/state", { token: t1 })).data;
  assert.equal(s1.roadmap, "chrono");
  assert.equal(s1.perDay, 5);
  assert.equal(s1.plan.length, 238);
  assert.equal(formatChapters(s1.plan[0].chapters), "창세기 1–5장");

  // 예전 화면처럼 roadmap 없이 시작하면 기존과 같은 397일 · 하루 3장
  const t2 = await join(call, {});
  const s2 = (await call("/api/state", { token: t2 })).data;
  assert.equal(s2.roadmap, "flow397");
  assert.deepEqual(s2.plan, buildDefaultPlan(3));

  assert.equal((await call("/api/join", { method: "POST", body: { name: "나", start_date: "2026-10-01", roadmap: "없음" } })).status, 400);
  assert.equal((await call("/api/join", { method: "POST", body: { name: "나", start_date: "2026-10-01", per_day: 11 } })).status, 400);
});

test("개인 모드: 공동체성경읽기도 달력 날짜 본문, 수정 불가", async () => {
  const call = makeApp(createLocalDB({ mode: "personal" }));
  const t = await join(call, { roadmap: "community", start_date: "2026-10-02" });
  const s = (await call("/api/state", { token: t })).data;
  assert.equal(s.roadmap, "community");
  assert.deepEqual(s.plan[0].chapters, COMMUNITY[274].chapters);
  assert.equal((await call("/api/plan/day/1", { method: "PUT", body: { text: "창세기 1장" }, token: t })).status, 403);
  await call("/api/check", { method: "POST", token: t, body: { day: 1, chapter: "시편 119:33–64", checked: true } });
  assert.deepEqual((await call("/api/state", { token: t })).data.checks, { 1: ["시편 119:33–64"] });
});

test("개인 모드: 맥체인은 달력 날짜 본문, 수정 불가, 1년 뒤 자동 연장", async () => {
  const DB = createLocalDB({ mode: "personal" });
  const call = makeApp(DB);
  const t = await join(call, { roadmap: "mcheyne", start_date: "2025-10-01" });
  const s = (await call("/api/state", { token: t })).data;
  assert.equal(s.roadmap, "mcheyne");
  assert.deepEqual(s.plan[0].chapters, MCHEYNE["10-01"]);
  // 시작한 지 1년이 다 되어 가므로(오늘 기준) 다음 1년치가 덧붙어 있어야 한다
  assert.ok(s.plan.length > 365, `plan ${s.plan.length}일`);
  assert.deepEqual(s.plan[365].chapters, MCHEYNE["10-01"]);

  for (const [path, method, body] of [
    ["/api/plan/day/1", "PUT", { text: "창세기 1장" }],
    ["/api/plan/bulk", "PUT", { text: "DAY 1: 창세기 1장" }],
    ["/api/settings", "PUT", { start_date: "2025-01-01" }],
  ]) {
    assert.equal((await call(path, { method, body, token: t })).status, 403, path);
  }
});

test("개인 모드: 계획 바꾸기 → 새 계획으로 처음부터, 이전 체크는 보관", async () => {
  const DB = createLocalDB({ mode: "personal" });
  const call = makeApp(DB);
  const t = await join(call, {});
  await call("/api/check", { method: "POST", token: t, body: { day: 1, chapter: "누가복음 1", checked: true } });
  await call("/api/plan/day/2", { method: "PUT", token: t, body: { text: "누가복음 4장" } });
  const before = (await call("/api/history", { token: t })).data.history;
  assert.equal(before.length, 1);

  assert.equal((await call("/api/plan/choose", { method: "PUT", token: t, body: { roadmap: "gospelA", per_day: 2, start_date: "2026-11-01" } })).status, 200);
  const s = (await call("/api/state", { token: t })).data;
  assert.equal(s.roadmap, "gospelA");
  assert.equal(s.startDate, "2026-11-01");
  assert.equal(s.plan.length, 595);
  assert.deepEqual(s.checks, {}); // 새 계획은 체크 없이 시작

  // 이전 계획의 기록은 목록에서 빠지고 되돌릴 수 없다. 계획 바꾸기 기록만 보인다.
  const after = (await call("/api/history", { token: t })).data.history;
  assert.equal(after.length, 1);
  assert.match(after[0].summary, /읽기 계획: 예수님에서 시작하는 통독 · 하루 3장/);
  assert.equal((await call(`/api/history/${before[0].id}/revert`, { method: "POST", token: t })).status, 404);
  assert.equal((await call(`/api/history/${after[0].id}/revert`, { method: "POST", token: t })).status, 409);

  // 이전 체크는 DB 에 보관되어 있다
  const kept = await DB.prepare("SELECT plan_version, chapter FROM checks").all();
  assert.deepEqual(kept.results.map((r) => ({ ...r })), [{ plan_version: 0, chapter: "누가복음 1" }]);
});

test("기존 사용자: 옛 구조 DB 에 변경 파일을 적용해도 그대로", async () => {
  // 옛 구조(변경 전)로 기존 사용자를 만든다
  const DB = createLocalDB({ mode: "personal", migrate: false });
  await DB.prepare("INSERT INTO members (name, token, recovery_code, start_date, created_at) VALUES ('새벽', 'tok', 'AAAA-BBBB', '2026-09-29', 'x')").run();
  await DB.prepare("INSERT INTO member_plan (member_id, day, chapters) SELECT 1, day, chapters FROM plan_days").run();
  await DB.prepare("INSERT INTO checks (member_id, day, chapter, checked_at) VALUES (1, 1, '누가복음 1', 'x'), (1, 2, '누가복음 4', 'x')").run();

  for (const sql of personalMigrations()) DB.exec(sql);

  const call = makeApp(DB);
  const s = (await call("/api/state", { token: "tok" })).data;
  assert.equal(s.roadmap, "flow397");
  assert.equal(s.perDay, 3);
  assert.equal(s.startDate, "2026-09-29");
  assert.deepEqual(s.plan, buildDefaultPlan(3));
  assert.deepEqual(s.checks, { 1: ["누가복음 1"], 2: ["누가복음 4"] });
  assert.equal(s.me.recoveryCode, "AAAA-BBBB");
  // 체크도 계속 된다
  await call("/api/check", { method: "POST", token: "tok", body: { day: 2, chapter: "누가복음 5", checked: true } });
  assert.deepEqual((await call("/api/state", { token: "tok" })).data.checks[2].sort(), ["누가복음 4", "누가복음 5"]);
});

test("어성경 순서 파일: 절 단위 범위를 장으로, 1,189장 모두", async () => {
  const { parseRef, buildEoseong } = await import("../scripts/build-eoseong.mjs");
  const { readFileSync } = await import("node:fs");
  const { EOSEONG } = await import("../public/shared/eoseong.js");
  assert.deepEqual(parseRef("출1:1-4:17"), ["출애굽기", 1, 4, false]);
  assert.deepEqual(parseRef("요7:11-8장"), ["요한복음", 7, 8, true]);
  assert.deepEqual(parseRef("민9:1-14"), ["민수기", 9, 9, false]);
  assert.deepEqual(parseRef("시59"), ["시편", 59, 59, false]);
  assert.deepEqual(parseRef("요일1-5"), ["요한일서", 1, 5, false]);
  // 생성 파일이 원본과 같은지 (원본만 고치고 다시 만들지 않은 경우 잡기)
  assert.deepEqual(buildEoseong(readFileSync(new URL("../data/eoseong-order.txt", import.meta.url), "utf8")), EOSEONG);
});
