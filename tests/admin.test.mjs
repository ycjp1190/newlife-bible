// 개인 모드 관리자 통계 · 설치형 앱 사용 기록 검사
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/index.js";
import { createLocalDB, personalMigrations } from "../scripts/d1-local.mjs";

function makeApp({ mode = "personal", admin = "secret-code", DB = createLocalDB({ mode }) } = {}) {
  const env = { DB, ASSETS: { fetch: () => new Response("") }, INVITE_CODE: "test", ...(mode === "personal" ? { MODE: "personal" } : {}), ...(admin ? { ADMIN_CODE: admin } : {}) };
  return async (path, { method = "GET", body, token, headers = {} } = {}) => {
    const res = await worker.fetch(new Request("https://app.test" + path, {
      method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}
const join = async (call, name, roadmap = "flow397") =>
  (await call("/api/join", { method: "POST", body: { name, start_date: "2026-10-01", roadmap } })).data.token;

test("관리자 통계: 코드가 맞아야 보이고, 운영자에게는 실명", async () => {
  const call = makeApp();
  const a = await join(call, "홍길동");
  await join(call, "김철", "community");
  await join(call, "남궁민수", "chrono");
  await call("/api/state", { token: a, headers: { "X-App-Mode": "standalone" } }); // 홍길동만 설치형 앱으로 염

  assert.equal((await call("/api/admin/stats")).status, 403);
  assert.equal((await call("/api/admin/stats", { headers: { "X-Admin-Code": encodeURIComponent("틀림") } })).status, 403);
  const { summary, users } = (await call("/api/admin/stats", { headers: { "X-Admin-Code": "secret-code" } })).data;
  assert.equal(summary.total, 3);
  assert.equal(summary.installed, 1);
  assert.equal(summary.byRoadmap.community, 1);
  assert.deepEqual(users.map((u) => u.name), ["홍길동", "김철", "남궁민수"]);
  assert.ok(users[0].appFirstAt && users[0].appLastAt);
  assert.equal(users[1].appFirstAt, null);
});

test("관리자 통계: 코드가 설정 안 됐거나 모임 모드면 없음", async () => {
  assert.equal((await makeApp({ admin: null })("/api/admin/stats", { headers: { "X-Admin-Code": "x" } })).status, 404);
  assert.equal((await makeApp({ mode: "group" })("/api/admin/stats", { headers: { "X-Admin-Code": "secret-code" } })).status, 404);
});

test("설치 기록 변경 파일: 기존 개인 DB 에 적용해도 그대로", async () => {
  const DB = createLocalDB({ mode: "personal", migrate: false });
  DB.exec(personalMigrations()[0]); // 0001 까지만 적용된 상태
  await DB.prepare("INSERT INTO members (name, token, recovery_code, start_date, created_at) VALUES ('새벽', 'tok', 'AAAA-BBBB', '2026-09-29', 'x')").run();
  await DB.prepare("INSERT INTO member_plan (member_id, day, chapters) SELECT 1, day, chapters FROM plan_days").run();
  for (const sql of personalMigrations().slice(1)) DB.exec(sql);
  const call = makeApp({ DB });
  const s = (await call("/api/state", { token: "tok", headers: { "X-App-Mode": "standalone" } })).data;
  assert.equal(s.me.name, "새벽");
  assert.equal(s.plan.length, 397);
  const { users } = (await call("/api/admin/stats", { headers: { "X-Admin-Code": "secret-code" } })).data;
  assert.ok(users[0].appFirstAt);
});

test("시작할 때도 접속·앱 기록", async () => {
  const call = makeApp();
  await call("/api/join", { method: "POST", body: { name: "앱사람", start_date: "2026-10-01" }, headers: { "X-App-Mode": "standalone" } });
  await call("/api/join", { method: "POST", body: { name: "웹사람", start_date: "2026-10-01" } });
  const { users } = (await call("/api/admin/stats", { headers: { "X-Admin-Code": "secret-code" } })).data;
  assert.ok(users[0].lastSeenAt && users[0].appFirstAt);
  assert.ok(users[1].lastSeenAt);
  assert.equal(users[1].appFirstAt, null);
});

test("테스트 이름은 통계에서 빠지고, 관리자는 계정을 지울 수 있다", async () => {
  const DB = createLocalDB({ mode: "personal" });
  const env = { DB, ASSETS: { fetch: () => new Response("") }, MODE: "personal", ADMIN_CODE: "c", TEST_NAMES: "Admin" };
  const call = async (path, { method = "GET", body, headers = {}, token } = {}) => {
    const res = await worker.fetch(new Request("https://app.test" + path, { method, headers: { "Content-Type": "application/json", ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil() {} });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const t = (await call("/api/join", { method: "POST", body: { name: "admin", start_date: "2026-10-01" } })).data;
  await call("/api/join", { method: "POST", body: { name: "실사용자", start_date: "2026-10-01" } });
  await call("/api/check", { method: "POST", token: t.token, body: { day: 1, chapter: "누가복음 1", checked: true } });
  let stats = (await call("/api/admin/stats", { headers: { "X-Admin-Code": "c" } })).data;
  assert.equal(stats.summary.total, 1);
  assert.equal(stats.summary.tests, 1);
  assert.equal(stats.users.find((u) => u.name === "admin").test, true);

  assert.equal((await call("/api/admin/delete", { method: "POST", body: { id: t.member.id } })).status, 403);
  assert.equal((await call("/api/admin/delete", { method: "POST", headers: { "X-Admin-Code": "c" }, body: { id: t.member.id } })).status, 200);
  stats = (await call("/api/admin/stats", { headers: { "X-Admin-Code": "c" } })).data;
  assert.deepEqual(stats.users.map((u) => u.name), ["실사용자"]);
  for (const table of ["member_plan", "checks"]) {
    assert.equal((await DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id = ?`).bind(t.member.id).first()).n, 0);
  }
  assert.equal((await call("/api/state", { token: t.token })).status, 401); // 지운 계정은 다시 입장해야 함
});

test("관리자 화면은 개인용 앱 안의 탭: ?admin 으로 열어도 일반 개인용 첫 화면", async () => {
  const html = '<title>말씀 읽고 새 인생</title><link rel="manifest" href="/manifest.webmanifest"><meta name="apple-mobile-web-app-title" content="말씀 새 인생">';
  const env = { DB: createLocalDB({ mode: "personal" }), MODE: "personal", ASSETS: { fetch: (req) => {
    const p = new URL(req.url).pathname;
    return p === "/" ? new Response(html, { headers: { "Content-Type": "text/html" } }) : new Response(`asset:${p}`);
  } } };
  const get = async (path) => (await worker.fetch(new Request("https://app.test" + path), env, { waitUntil() {} })).text();
  for (const path of ["/", "/?admin"]) {
    const page = await get(path);
    assert.match(page, /content="말씀 새 인생 개인용"/);
    assert.match(page, /href="\/manifest\.webmanifest"/);
    assert.doesNotMatch(page, /admin/);
  }
  assert.equal(await get("/manifest.webmanifest"), "asset:/personal/manifest.webmanifest");
});

test("개인용 링크 미리보기: 공유했을 때 제목·설명·아이콘", async () => {
  const html = '<title>말씀 읽고 새 인생</title><meta name="description" content="397일 성경읽기"><meta name="apple-mobile-web-app-title" content="말씀 새 인생">';
  const env = { DB: createLocalDB({ mode: "personal" }), MODE: "personal", ASSETS: { fetch: () => new Response(html, { headers: { "Content-Type": "text/html" } }) } };
  const page = await (await worker.fetch(new Request("https://p.test/"), env, { waitUntil() {} })).text();
  assert.match(page, /property="og:title" content="말씀 읽고 새 인생 \(개인용\)"/);
  assert.match(page, /property="og:image" content="https:\/\/p\.test\/icons\/icon-512\.png"/);
  assert.doesNotMatch(page, /397일 성경읽기/);
});
