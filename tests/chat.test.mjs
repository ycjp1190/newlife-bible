// 대화(단톡방) 검사 — 모임 모드 전용
import { test } from "node:test";
import assert from "node:assert/strict";
import { kstToday } from "../public/shared/bible.js";
import worker from "../worker/index.js";
import { createLocalDB, migrations } from "../scripts/d1-local.mjs";

function makeApp(mode = "group", DB = createLocalDB({ mode })) {
  const env = { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ...(mode === "personal" ? { MODE: "personal" } : {}) };
  return async (path, { method = "GET", body, token } = {}) => {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const join = async (call, name) => (await call("/api/join", { method: "POST", body: { name, invite: "test" } })).data.token;

test("대화: 보내기·불러오기·안 읽은 수·공감·지우기", async () => {
  const call = makeApp();
  const a = await join(call, "가");
  const b = await join(call, "나");
  assert.equal((await call("/api/chat", { method: "POST", token: a, body: { body: "  " } })).status, 400);
  assert.equal((await call("/api/chat", { method: "POST", token: a, body: { body: "x".repeat(1001) } })).status, 400);

  const m1 = (await call("/api/chat", { method: "POST", token: a, body: { body: "안녕하세요\n오늘도 화이팅" } })).data.message;
  assert.equal(m1.name, "가");
  assert.equal(m1.body, "안녕하세요\n오늘도 화이팅");
  await call("/api/chat", { method: "POST", token: a, body: { body: "두 번째" } });

  // 나에게는 안 읽은 3개(가의 환영 인사 + 메시지 2), 메시지를 보낸 가는 그때까지 읽은 것으로 0개
  assert.equal((await call("/api/state", { token: b })).data.chatUnread, 3);
  assert.equal((await call("/api/state", { token: a })).data.chatUnread, 0);
  const list = (await call("/api/chat", { token: b })).data.messages;
  assert.deepEqual(list.map((m) => m.kind), ["join", "join", "text", "text"]);
  assert.deepEqual(list.filter((m) => m.kind === "text").map((m) => m.body), ["안녕하세요\n오늘도 화이팅", "두 번째"]);
  await call("/api/chat/read", { method: "POST", token: b, body: { id: list.at(-1).id } });
  assert.equal((await call("/api/state", { token: b })).data.chatUnread, 0);

  // 공감 켜기·끄기, 새 메시지 확인할 때 공감 변화도 함께 온다
  assert.equal((await call(`/api/chat/${m1.id}/react`, { method: "POST", token: b, body: { emoji: "🙏" } })).data.on, true);
  assert.equal((await call(`/api/chat/${m1.id}/react`, { method: "POST", token: b, body: { emoji: "😀" } })).status, 400);
  assert.equal((await call(`/api/chat/${m1.id}/react`, { method: "POST", token: a, body: { emoji: "👏" } })).data.on, true); // 박수
  await call(`/api/chat/${m1.id}/react`, { method: "POST", token: a, body: { emoji: "👏" } });
  const poll = (await call(`/api/chat?after=${list.at(-1).id}&from=${m1.id}`, { token: a })).data;
  assert.equal(poll.messages.length, 0);
  assert.deepEqual(poll.updates.find((m) => m.id === m1.id).reactions, { "🙏": [2] });
  assert.equal((await call(`/api/chat/${m1.id}/react`, { method: "POST", token: b, body: { emoji: "🙏" } })).data.on, false);

  // 남의 메시지는 못 지우고, 내 메시지는 지우면 내용이 비워진다
  assert.equal((await call(`/api/chat/${m1.id}`, { method: "DELETE", token: b })).status, 403);
  assert.equal((await call(`/api/chat/${m1.id}`, { method: "DELETE", token: a })).status, 200);
  const after = (await call("/api/chat", { token: b })).data.messages.find((m) => m.id === m1.id);
  assert.equal(after.deleted, true);
  assert.equal(after.body, "");
});

test("대화: 오늘 분량을 다 읽으면 완료 소식 (하루 한 번, 지난 날 제외)", async () => {
  const call = makeApp();
  const a = await join(call, "가");
  const yesterday = new Date(Date.parse(kstToday() + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  await call("/api/settings", { method: "PUT", token: a, body: { start_date: yesterday } }); // 오늘 = DAY 2
  const check = (day, c, checked = true) => call("/api/check", { method: "POST", token: a, body: { day, chapter: `누가복음 ${c}`, checked } });
  for (const c of [1, 2, 3]) await check(1, c); // 어제 분량 → 소식 없음
  for (const c of [4, 5]) await check(2, c);
  const done = async () => (await call("/api/chat", { token: a })).data.messages.filter((m) => m.kind === "done");
  assert.equal((await done()).length, 0); // 아직 다 안 읽음
  await check(2, 6);
  await check(2, 6, false);
  await check(2, 6); // 풀었다 다시 체크해도 한 번만
  const msgs = await done();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].kind, "done");
  assert.equal(msgs[0].day, 2);
  // 체크를 풀면 완료 소식이 지워지고, 다시 다 체크하면 다시 올라간다
  await check(2, 5, false);
  assert.equal((await done()).length, 0);
  await check(2, 5);
  assert.equal((await done()).length, 1);
  // 완료 소식은 안 읽은 수에 세지 않는다 (가의 환영 인사 1개만)
  const b = await join(call, "나");
  assert.equal((await call("/api/state", { token: b })).data.chatUnread, 1);
});

test("대화 알림 켜기·끄기 (기본 켜짐)", async () => {
  const call = makeApp();
  const a = await join(call, "가");
  assert.equal((await call("/api/state", { token: a })).data.me.chat_push, true);
  await call("/api/me", { method: "PUT", token: a, body: { chat_push: false } });
  assert.equal((await call("/api/state", { token: a })).data.me.chat_push, false);
});

test("개인 모드에는 대화가 없다", async () => {
  const call = makeApp("personal");
  const t = (await call("/api/join", { method: "POST", body: { name: "혼자", start_date: "2026-10-01" } })).data.token;
  assert.equal((await call("/api/chat", { token: t })).status, 404);
  assert.equal((await call("/api/state", { token: t })).data.chatUnread, undefined);
});

test("기존 모임 DB: 변경 파일을 적용해도 멤버·체크 그대로", async () => {
  const DB = createLocalDB({ mode: "group", migrate: false });
  await DB.prepare("INSERT INTO members (name, token, created_at) VALUES ('예찬', 'tok', 'x')").run();
  await DB.prepare("INSERT INTO settings (key, value) VALUES ('start_date', '2026-09-28')").run();
  await DB.prepare("INSERT INTO checks (member_id, day, chapter, checked_at) VALUES (1, 1, '누가복음 1', 'x')").run();
  for (const sql of migrations("group")) DB.exec(sql);
  const call = makeApp("group", DB);
  const s = (await call("/api/state", { token: "tok" })).data;
  assert.equal(s.me.name, "예찬");
  assert.equal(s.startDate, "2026-09-28");
  assert.deepEqual(s.checks, { 1: ["누가복음 1"] });
  assert.equal(s.chatUnread, 0);
  assert.equal(s.me.chat_push, true);
  assert.equal(s.noticeSeen, 0); // 기존 모임원은 업데이트 소식을 새 소식으로 본다
  assert.equal(s.readDays, 127);
});

test("대화: 카톡식 안 읽음 숫자용 읽은 위치(reads)", async () => {
  const call = makeApp();
  const a = await join(call, "가");
  const b = await join(call, "나");
  const c = await join(call, "다");
  const m = (await call("/api/chat", { method: "POST", token: a, body: { body: "안녕" } })).data.message;
  const unread = async () => {
    const { reads } = (await call("/api/chat", { token: a })).data;
    return reads.filter((r) => r.id !== m.member_id && r.last_read < m.id).length;
  };
  assert.equal(await unread(), 2); // 나·다 안 읽음 (보낸 가는 제외)
  await call("/api/chat/read", { method: "POST", token: b, body: { id: m.id } });
  assert.equal(await unread(), 1);
  await call("/api/chat/read", { method: "POST", token: c, body: { id: m.id } });
  assert.equal(await unread(), 0);
});

test("대화 실시간 연결: 토큰 없으면 401, 개인 모드 404", async () => {
  const call = makeApp();
  assert.equal((await call("/api/chat/ws")).status, 401);
  assert.equal((await call("/api/chat/ws?token=wrong")).status, 401);
  const a = await join(call, "가");
  assert.equal((await call(`/api/chat/ws?token=${a}`)).status, 404); // 검사 환경엔 실시간 대화방이 없음
  const p = makeApp("personal");
  assert.equal((await p("/api/chat/ws?token=x")).status, 404);
});

test("새 모임원: 대화방에 환영 인사 (처음 한 번, 다시 입장하면 없음)", async () => {
  const call = makeApp();
  const a = await join(call, "가");
  const yesterday = new Date(Date.parse(kstToday() + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
  await call("/api/settings", { method: "PUT", token: a, body: { start_date: yesterday } }); // 오늘 = DAY 2
  await join(call, "새식구");
  await join(call, "새식구"); // 다시 입장
  const joins = (await call("/api/chat", { token: a })).data.messages.filter((m) => m.kind === "join");
  assert.equal(joins.length, 2); // 가(시작 전) + 새식구
  assert.match(joins[0].body, /가님|시작일부터/);
  assert.match(joins[1].body, /새식구/);
  assert.match(joins[1].body, /DAY 2부터/);
  assert.equal(joins[1].name, "새식구");
});
