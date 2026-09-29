// 서버 API 를 실제 코드 그대로, 메모리 속 임시 DB 로 검사한다. (모임 모드·개인 모드 모두)
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createLocalDB } from "../scripts/d1-local.mjs";

function makeApp(mode) {
  const env = {
    DB: createLocalDB({ mode }),
    ASSETS: {
      fetch: (req) => {
        const path = new URL(req.url).pathname;
        return path === "/" || path === "/index.html"
          ? new Response('<title>말씀 읽고 새 인생</title><meta name="apple-mobile-web-app-title" content="말씀 새 인생">', { headers: { "Content-Type": "text/html" } })
          : new Response(`asset:${path}`);
      },
    },
    INVITE_CODE: "test",
    ...(mode === "personal" ? { MODE: "personal" } : {}),
  };
  async function call(path, { method = "GET", body, token } = {}) {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }), env);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  return { env, call };
}

test("모임 모드: 입장·공통 시작일·함께 보기·범위 수정", async () => {
  const { call } = makeApp("group");
  assert.equal((await call("/api/config")).data.mode, "group");
  assert.equal((await call("/api/join", { method: "POST", body: { name: "가", invite: "틀림" } })).status, 403);

  const a = (await call("/api/join", { method: "POST", body: { name: "가", invite: "test" } })).data.token;
  const b = (await call("/api/join", { method: "POST", body: { name: "나", invite: "test" } })).data.token;
  // 같은 이름으로 다시 입장하면 같은 사람
  assert.equal((await call("/api/join", { method: "POST", body: { name: "가", invite: "test" } })).data.token, a);

  await call("/api/settings", { method: "PUT", token: a, body: { start_date: "2026-10-01" } });
  assert.equal((await call("/api/state", { token: b })).data.startDate, "2026-10-01"); // 공통

  await call("/api/plan/day/1", { method: "PUT", token: a, body: { text: "누가복음 1-4장" } });
  assert.equal((await call("/api/state", { token: b })).data.plan[0].chapters.length, 4); // 모두에게 적용

  const members = (await call("/api/members", { token: b })).data.members;
  assert.deepEqual(members.map((m) => m.name), ["가", "나"]);
  assert.equal((await call("/api/recover", { method: "POST", body: { code: "AAAA-AAAA" } })).status, 401);
  // 모임 모드는 개인용 파일을 보여 주지 않는다
  assert.equal((await call("/personal/icons/icon-192.png")).status, 404);
  assert.equal((await call("/icons/icon-192.png")).data, "asset:/icons/icon-192.png");
  // 모임 모드 앱 이름은 그대로
  assert.doesNotMatch((await call("/")).data, /개인용/);
});

test("개인 모드: 코드 없이 시작, 사람마다 시작일·읽기표·기록이 따로", async () => {
  const { call } = makeApp("personal");
  assert.equal((await call("/api/config")).data.mode, "personal");

  const j1 = (await call("/api/join", { method: "POST", body: { name: "홍길동", start_date: "2026-10-01" } })).data;
  const j2 = (await call("/api/join", { method: "POST", body: { name: "홍길동", start_date: "2026-11-01" } })).data;
  assert.notEqual(j1.token, j2.token); // 이름이 같아도 다른 사람
  assert.match(j1.member.recoveryCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const s1 = (await call("/api/state", { token: j1.token })).data;
  assert.equal(s1.mode, "personal");
  assert.equal(s1.startDate, "2026-10-01");
  assert.equal(s1.plan.length, 397);
  assert.equal((await call("/api/state", { token: j2.token })).data.startDate, "2026-11-01");

  // 한 사람이 읽기표를 바꿔도 다른 사람은 그대로
  await call("/api/plan/day/1", { method: "PUT", token: j1.token, body: { text: "누가복음 1장" } });
  assert.equal((await call("/api/state", { token: j1.token })).data.plan[0].chapters.length, 1);
  assert.equal((await call("/api/state", { token: j2.token })).data.plan[0].chapters.length, 3);

  // 변경 기록도 자기 것만 보이고, 남의 기록은 되돌릴 수 없다
  const h1 = (await call("/api/history", { token: j1.token })).data.history;
  assert.equal(h1.length, 1);
  assert.equal((await call("/api/history", { token: j2.token })).data.history.length, 0);
  assert.equal((await call(`/api/history/${h1[0].id}/revert`, { method: "POST", token: j2.token })).status, 404);
  await call(`/api/history/${h1[0].id}/revert`, { method: "POST", token: j1.token });
  assert.equal((await call("/api/state", { token: j1.token })).data.plan[0].chapters.length, 3);

  // 시작일도 나만
  await call("/api/settings", { method: "PUT", token: j1.token, body: { start_date: "2026-09-01" } });
  assert.equal((await call("/api/state", { token: j2.token })).data.startDate, "2026-11-01");

  // 함께 보기 없음
  assert.equal((await call("/api/members", { token: j1.token })).status, 404);

  // 복구 코드로 이어 쓰기 (소문자·띄어쓰기도 허용)
  const typed = j1.member.recoveryCode.toLowerCase().replace("-", " ");
  assert.equal((await call("/api/recover", { method: "POST", body: { code: typed } })).data.token, j1.token);
  assert.equal((await call("/api/recover", { method: "POST", body: { code: "ZZZZ-ZZZZ" } })).status, 404);

  // 개인 모드 아이콘은 개인용 파일로 바뀐다
  assert.equal((await call("/icons/icon-192.png")).data, "asset:/personal/icons/icon-192.png");
  assert.equal((await call("/manifest.webmanifest")).data, "asset:/personal/manifest.webmanifest");
  // 개인 모드 앱 이름: 탭 제목·아이폰 홈 화면 이름에 "개인용"
  const html = (await call("/")).data;
  assert.match(html, /<title>말씀 읽고 새 인생 \(개인용\)<\/title>/);
  assert.match(html, /content="말씀 새 인생 개인용"/);
});
