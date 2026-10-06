// 의견·제보: 보내기, 익명, 관리자 답변, 답변 알림 표시 (두 모드)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createLocalDB, migrations } from "../scripts/d1-local.mjs";

function makeApp(mode) {
  const DB = createLocalDB({ mode });
  const env = { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ADMIN_CODE: "c", ...(mode === "personal" ? { MODE: "personal" } : {}) };
  const call = async (path, { method = "GET", body, token, admin } = {}) => {
    const res = await worker.fetch(new Request("https://app.test/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(admin !== undefined ? { "X-Admin-Code": admin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const join = async (name) => (await call("/join", { method: "POST", body: mode === "personal" ? { name, start_date: "2026-10-01" } : { name, invite: "test" } })).data.token;
  return { call, join, DB };
}

for (const mode of ["group", "personal"]) {
  test(`의견·제보 (${mode === "group" ? "모임" : "개인"} 모드)`, async () => {
    const { call, join } = makeApp(mode);
    const a = await join("가");
    const b = await join("나");
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "zzz", body: "x" } })).status, 400);
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "bug", body: "  " } })).status, 400);
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "bug", body: "x".repeat(2001) } })).status, 400);
    await call("/feedback", { method: "POST", token: a, body: { kind: "bug", body: "알림이 늦어요" } });
    await call("/feedback", { method: "POST", token: b, body: { kind: "idea", body: "글자 크게", anonymous: true } });

    // 내 목록에는 내 것만
    assert.deepEqual((await call("/feedback", { token: a })).data.feedback.map((f) => f.body), ["알림이 늦어요"]);
    // 관리자: 코드 없으면 403, 익명은 이름 없이
    assert.equal((await call("/admin/feedback")).status, 403);
    assert.equal((await call("/admin/feedback", { admin: encodeURIComponent("틀림") })).status, 403);
    const list = (await call("/admin/feedback", { admin: "c" })).data;
    assert.equal(list.newCount, 2);
    assert.deepEqual(list.feedback.map((f) => f.name), ["익명", "가"]);
    assert.equal(list.feedback[0].member_id, undefined);
    // 답변 → 제보자에게 '새 답변' 1, 목록을 열면 0
    const id = list.feedback[1].id;
    assert.equal((await call(`/admin/feedback/${id}`, { method: "POST", admin: "x", body: { reply: "고칠게요" } })).status, 403);
    assert.equal((await call(`/admin/feedback/${id}`, { method: "POST", admin: "c", body: { status: "zzz" } })).status, 400);
    await call(`/admin/feedback/${id}`, { method: "POST", admin: "c", body: { reply: "고칠게요", status: "done" } });
    assert.equal((await call("/state", { token: a })).data.feedbackReplies, 1);
    assert.equal((await call("/state", { token: b })).data.feedbackReplies, 0);
    const mine = (await call("/feedback", { token: a })).data.feedback[0];
    assert.equal(mine.reply, "고칠게요");
    assert.equal(mine.status, "done");
    assert.equal(mine.replyNew, true);
    assert.equal((await call("/state", { token: a })).data.feedbackReplies, 0);
    // 상태만 바꾸기
    await call(`/admin/feedback/${list.feedback[0].id}`, { method: "POST", admin: "c", body: { status: "seen" } });
    assert.equal((await call("/admin/feedback", { admin: "c" })).data.newCount, 0);
    // 하루 20건까지
    for (let i = 0; i < 19; i++) await call("/feedback", { method: "POST", token: a, body: { kind: "etc", body: `${i}` } });
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "etc", body: "21" } })).status, 429);
    // 사용자 통계는 개인 모드에서만
    assert.equal((await call("/admin/stats", { admin: "c" })).status, mode === "personal" ? 200 : 404);
  });
}

test("기존 DB 에 0004 적용: 데이터 그대로, 제보 표 생김", async () => {
  for (const mode of ["group", "personal"]) {
    const DB = createLocalDB({ mode, migrate: false });
    const ms = migrations(mode);
    for (const sql of ms.slice(0, -1)) DB.exec(sql);
    const before = (await DB.prepare("SELECT COUNT(*) AS n FROM plan_days").first()).n;
    DB.exec(ms.at(-1));
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM plan_days").first()).n, before);
    assert.equal((await DB.prepare("SELECT COUNT(*) AS n FROM feedback").first()).n, 0);
  }
});

for (const mode of ["group", "personal"]) {
  test(`일회용 설문 (${mode === "group" ? "모임" : "개인"} 모드)`, async () => {
    const { call, join } = makeApp(mode);
    const a = await join("가");
    assert.equal((await call("/state", { token: a })).data.surveyDone, false);
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "survey", body: " " } })).status, 400);
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "survey", body: "갓피플성경, 기타: 쉬운성경" } })).status, 200);
    assert.equal((await call("/state", { token: a })).data.surveyDone, true);
    assert.equal((await call("/feedback", { method: "POST", token: a, body: { kind: "survey", body: "종이 성경" } })).status, 409);
    // 설문 답은 '내 제보'와 '새 제보 수'에 들어가지 않고, 관리자 목록에는 보인다
    assert.equal((await call("/feedback", { token: a })).data.feedback.length, 0);
    const admin = (await call("/admin/feedback", { admin: "c" })).data;
    assert.equal(admin.newCount, 0);
    assert.equal(admin.feedback[0].kind, "survey");
    assert.equal(admin.feedback[0].body, "갓피플성경, 기타: 쉬운성경");
  });
}
