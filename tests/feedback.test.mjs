// 의견·제보: 보내기, 익명, 관리자 답변, 답변 알림 표시 (두 모드)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { b64urlEncode, generateVapidKeys } from "../worker/push.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { createLocalDB, migrations } from "../scripts/d1-local.mjs";

function makeApp(mode) {
  const DB = createLocalDB({ mode });
  const env = { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ADMIN_CODE: "c", ...(mode === "personal" ? { MODE: "personal" } : {}) };
  const pending = [];
  const call = async (path, { method = "GET", body, token, admin } = {}) => {
    const res = await worker.fetch(new Request("https://app.test/api" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(admin !== undefined ? { "X-Admin-Code": admin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil: (p) => pending.push(p) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const join = async (name) => (await call("/join", { method: "POST", body: mode === "personal" ? { name, start_date: "2026-10-01" } : { name, invite: "test" } })).data.token;
  return { call, join, DB, env, pending, flush: async () => { await Promise.all(pending.splice(0)); } };
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
    // 사용자 현황은 두 모드 모두 (계정 삭제는 개인 모드만)
    const st = (await call("/admin/stats", { admin: "c" })).data;
    assert.equal(st.summary.total, 2);
    assert.equal(st.summary.byRoadmap !== undefined, mode === "personal");
    assert.equal((await call("/admin/delete", { method: "POST", admin: "c", body: { id: 1 } })).status, mode === "personal" ? 200 : 404);
  });
}

test("기존 DB 에 0004 적용: 데이터 그대로, 제보 표 생김", async () => {
  for (const mode of ["group", "personal"]) {
    const DB = createLocalDB({ mode, migrate: false });
    const ms = migrations(mode);
    for (const sql of ms.slice(0, 3)) DB.exec(sql);
    const before = (await DB.prepare("SELECT COUNT(*) AS n FROM plan_days").first()).n;
    DB.exec(ms[3]);
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

test("모임 모드: 홈 화면 앱으로 열면 앱 사용 기록", async () => {
  const { call, join, DB } = makeApp("group");
  const a = await join("가");
  await worker.fetch(new Request("https://app.test/api/state", { headers: { Authorization: `Bearer ${a}`, "X-App-Mode": "standalone" } }),
    { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ADMIN_CODE: "c" }, { waitUntil() {} });
  const u = (await call("/admin/stats", { admin: "c" })).data.users[0];
  assert.ok(u.appFirstAt && u.lastSeenAt);
  assert.equal(u.joinDay, 1);
});


// 실제 암호화 경로를 통과한 알림을 폰 쪽 키로 읽는다(기존 app.test.mjs와 같은 WebCrypto 방식).
async function pushReceiver() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();
  const hkdf = async (salt, ikm, info, length) => {
    const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
  };
  return {
    keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) },
    async read(body) {
      const salt = body.slice(0, 16), sender = body.slice(21, 21 + body[20]);
      const key = await crypto.subtle.importKey("raw", sender, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: key }, pair.privateKey, 256));
      const ikm = await hkdf(auth, secret, new Uint8Array([...enc.encode("WebPush: info\0"), ...pub, ...sender]), 32);
      const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
      const iv = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
      const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aes, body.slice(21 + body[20])));
      assert.equal(plain.at(-1), 2);
      return JSON.parse(new TextDecoder().decode(plain.slice(0, -1)));
    },
  };
}

for (const mode of ["group", "personal"]) {
  test(`관리자 알림 (${mode}): 코드+회원 인증, on/off, 실제 푸시 대상·내용·설문 제외·실패 격리`, { timeout: 5000 }, async (t) => {
    const { call, join, DB, env, pending, flush } = makeApp(mode);
    const a = await join("관리자본인"), b = await join("다른관리자"), c = await join("일반회원");
    await flush(); // 모임 입장 환영 알림을 분리
    const keys = await generateVapidKeys();
    Object.assign(env, { VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey, VAPID_SUBJECT: "https://app.test" });
    env.ADMIN_CODE = "관리자 코드";
    const admin = encodeURIComponent(env.ADMIN_CODE);
    const notify = (token, on, code = admin) => call("/admin/notify", { method: "POST", token, admin: code, body: { on } });
    assert.equal((await notify(undefined, true)).status, 401);
    assert.equal((await notify("invalid-token", true)).status, 401);
    assert.equal((await notify(a, true, encodeURIComponent("틀림"))).status, 403);
    for (const on of [undefined, null, 1, "true", {}]) assert.equal((await notify(a, on)).status, 400);
    const flags = async () => (await DB.prepare("SELECT admin_notify FROM members ORDER BY id").all()).results.map(r => r.admin_notify);
    assert.deepEqual(await flags(), [0, 0, 0]);
    delete env.ADMIN_CODE;
    assert.equal((await notify(a, true)).status, 404);
    env.ADMIN_CODE = "관리자 코드";
    assert.equal((await notify(a, true)).status, 200);
    assert.equal((await notify(b, true)).status, 200);
    assert.deepEqual(await flags(), [1, 1, 0]);
    // 끄기는 코드가 틀려도(관리자 코드가 바뀐 기기) 본인 알림만 꺼진다.
    assert.equal((await notify(a, false, encodeURIComponent("틀림"))).status, 200);
    assert.deepEqual(await flags(), [0, 1, 0]);
    assert.equal((await notify(a, true)).status, 200);
    assert.equal((await notify(b, false)).status, 200);
    assert.deepEqual(await flags(), [1, 0, 0]);
    await notify(b, true);

    const receiver = await pushReceiver();
    const subscriptions = [[a, "admin-a"], [b, "admin-b"], [c, "ordinary"]];
    for (const [token, device] of subscriptions) {
      const { id } = await DB.prepare("SELECT id FROM members WHERE token = ?").bind(token).first();
      await DB.prepare("INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(`https://push.test/${device}`, id, receiver.keys.p256dh, receiver.keys.auth, new Date().toISOString()).run();
    }
    // 한 관리자의 여러 기기도 모두 기존 pushToMember 경로로 받는다.
    const { id } = await DB.prepare("SELECT id FROM members WHERE token = ?").bind(a).first();
    await DB.prepare("INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)")
      .bind("https://push.test/admin-a2", id, receiver.keys.p256dh, receiver.keys.auth, new Date().toISOString()).run();
    const received = [];
    let release;
    const delayed = new Promise(resolve => { release = resolve; });
    let fail = false;
    t.mock.method(globalThis, "fetch", async (url, options) => {
      received.push({ url, payload: await receiver.read(options.body) });
      await delayed;
      if (fail && url.endsWith("admin-b")) throw new Error("시험용 푸시 실패");
      return new Response("", { status: 201 });
    });
    // 수신처 응답이 멈춰 있어도 제보 API는 먼저 성공한다.
    const text = "가".repeat(65);
    const response = await call("/feedback", { method: "POST", token: a, body: { kind: "bug", body: text, anonymous: true } });
    assert.equal(response.status, 200);
    assert.equal(pending.length, 1);
    release();
    await flush();
    assert.deepEqual(received.map(r => r.url).sort(), ["admin-a", "admin-a2", "admin-b"].map(d => `https://push.test/${d}`).sort());
    for (const { payload } of received) {
      assert.deepEqual(payload, { title: "📮 새 의견·제보가 왔어요", body: `불편·오류 · ${"가".repeat(60)}`, url: "/?tab=admin", tag: "admin-feedback" });
      assert.ok(!payload.body.includes("관리자본인"));
    }
    received.length = 0;
    await call("/feedback", { method: "POST", token: c, body: { kind: "survey", body: "종이성경" } });
    assert.equal(pending.length, 0);
    await flush();
    assert.equal(received.length, 0);
    await notify(a, false);
    await notify(c, true);
    const failures = [];
    t.mock.method(console, "error", (...args) => failures.push(args));
    fail = true;
    assert.equal((await call("/feedback", { method: "POST", token: c, body: { kind: "idea", body: "개선해 주세요" } })).status, 200);
    await flush();
    assert.deepEqual(received.map(r => r.url).sort(), ["https://push.test/admin-b", "https://push.test/ordinary"]);
    for (const { payload } of received) assert.equal(payload.body, "개선 제안 · 개선해 주세요");
    assert.ok(failures.length > 0);
    assert.equal((await call("/admin/feedback", { admin })).data.newCount, 2);
    received.length = 0;
    await notify(b, false);
    await notify(c, false);
    await call("/feedback", { method: "POST", token: c, body: { kind: "etc", body: "기타 의견" } });
    await flush();
    assert.equal(received.length, 0);
  });

  test(`관리자 알림 migration (${mode}): 기존 회원·체크·제보 보존 및 로컬 DB 재실행`, async () => {
    const dir = mkdtempSync(pathJoin(tmpdir(), "bible-admin-notify-"));
    const path = pathJoin(dir, "preview.sqlite");
    let DB;
    try {
      DB = createLocalDB({ mode, path, migrate: false });
      const sqls = migrations(mode);
      for (const sql of sqls.slice(0, -1)) DB.exec(sql);
      // 기존 DB에 실제 가입 자료와 체크·제보를 담는다.
      const oldEnv = { DB, INVITE_CODE: "test", ...(mode === "personal" ? { MODE: "personal" } : {}) };
      const res = await worker.fetch(new Request("https://app.test/api/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "기존회원", invite: "test", start_date: "2026-10-01" }) }), oldEnv);
      assert.equal(res.status, 200);
      DB.exec("INSERT INTO checks (member_id, day, chapter, checked_at) VALUES (1, 1, '누가복음 1', '2026-10-01')");
      DB.exec("INSERT INTO feedback (member_id, kind, body, created_at) VALUES (1, 'bug', '기존 제보', '2026-10-01')");
      const before = {};
      for (const table of ["members", "checks", "feedback", "plan_days", ...(mode === "personal" ? ["member_plan"] : [])]) before[table] = (await DB.prepare(`SELECT * FROM ${table}`).all()).results.map(r => ({ ...r }));
      DB.close();
      DB = createLocalDB({ mode, path, fresh: false });
      const info = (await DB.prepare("PRAGMA table_info(members)").all()).results.find(c => c.name === "admin_notify");
      assert.equal(info.type, "INTEGER");
      assert.equal(info.notnull, 1);
      assert.equal(info.dflt_value, "0");
      for (const [table, rows] of Object.entries(before)) {
        const after = (await DB.prepare(`SELECT * FROM ${table}`).all()).results.map(r => { const { admin_notify, ...rest } = r; return rest; });
        assert.deepEqual(after, rows, table);
      }
      assert.equal((await DB.prepare("SELECT admin_notify FROM members").first()).admin_notify, 0);
      await DB.prepare("UPDATE members SET admin_notify = 1").run();
      DB.close();
      DB = createLocalDB({ mode, path, fresh: false });
      assert.equal((await DB.prepare("SELECT admin_notify FROM members").first()).admin_notify, 1);
    } finally { DB?.close(); rmSync(dir, { recursive: true, force: true }); }
  });
}
