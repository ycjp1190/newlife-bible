// 관리자 기기: 실제 앱 함수로 등록·재등록·해제·안내·푸시 링크 이동을 검사한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const navigationCode = source.slice(source.indexOf("function selectTab("), source.indexOf('if (S.tab === "plan")'));
const adminCode = source.slice(source.indexOf("async function adminApi("), source.indexOf("const FB_KIND ="));
const clickCode = source.slice(source.lastIndexOf('document.addEventListener("click"'), source.indexOf('document.addEventListener("change"'));
const settle = () => new Promise(resolve => setImmediate(resolve));

for (const mode of ["group", "personal"]) {
  test(`관리자 기기 (${mode}): 로그인·하루 단위 재등록·실패 재시도·로그아웃·무효 코드 해제`, async () => {
    const saved = new Map();
    const requests = [], messages = [];
    let clock = Date.now(), failNotify = false, valid = true, click;
    const context = createContext({
      S: { token: "member-token", mode },
      store: { get: key => saved.get(key), set: (key, value) => saved.set(key, value), del: key => saved.delete(key) },
      Date: class extends Date { static now() { return clock; } },
      fetch: async (path, options) => {
        requests.push({ path, options, body: options.body && JSON.parse(options.body) });
        const status = !valid ? 403 : failNotify && path.endsWith("/notify") ? 500 : 200;
        const data = path.endsWith("/feedback") ? { feedback: [], newCount: 1 } : { ok: true };
        return { status, ok: status === 200, json: async () => data };
      },
      closeSheet() {}, render() {}, openSheet() {}, esc: String, window: { scrollTo() {} },
      toast: text => messages.push(text), confirm: () => true,
      document: { addEventListener: (type, fn) => { if (type === "click") click = fn; } },
    });
    runInContext(adminCode + clickCode, context);
    const onCalls = () => requests.filter(r => r.path === "/api/admin/notify" && r.body.on);
    const offCalls = () => requests.filter(r => r.path === "/api/admin/notify" && !r.body.on);
    await runInContext('submitAdminCode({ code: { value: "관리자 코드" }, querySelector: () => ({ disabled: false }) })', context);
    await settle();
    assert.equal(saved.get("adminCode"), "관리자 코드");
    assert.equal(onCalls().length, 1);
    assert.equal(onCalls()[0].options.headers.Authorization, "Bearer member-token");
    assert.equal(onCalls()[0].options.headers["X-Admin-Code"], encodeURIComponent("관리자 코드"));
    assert.equal(onCalls()[0].options.method, "POST");
    assert.equal(context.S.tab, "admin");
    await runInContext("loadAdmin()", context);
    await settle();
    assert.equal(onCalls().length, 1);
    clock += 86400001;
    failNotify = true;
    await runInContext("loadAdmin()", context);
    await settle();
    assert.equal(onCalls().length, 2);
    assert.ok(context.S.admin); // 알림 실패에도 관리자 데이터는 정상
    failNotify = false;
    await runInContext("loadAdmin()", context);
    await settle();
    assert.equal(onCalls().length, 3);
    context.S.token = "another-member";
    await runInContext("loadAdmin()", context);
    await settle();
    assert.equal(onCalls().length, 4);
    assert.equal(onCalls().at(-1).options.headers.Authorization, "Bearer another-member");

    failNotify = true;
    await click({ target: { closest: () => ({ dataset: { action: "admin-logout" } }) } });
    await settle();
    assert.equal(offCalls().length, 1);
    assert.equal(offCalls()[0].options.headers["X-Admin-Code"], encodeURIComponent("관리자 코드"));
    assert.equal(saved.has("adminCode"), false);
    assert.equal(context.S.admin, null);
    assert.equal(saved.has("adminNotify:another-member"), false);
    saved.set("adminCode", "예전 코드");
    valid = false;
    await runInContext("loadAdmin()", context);
    await settle();
    assert.equal(offCalls().length, 2);
    assert.equal(saved.has("adminCode"), false);
    assert.equal(context.S.admin, null);
    assert.ok(messages.some(m => m.includes("관리자 코드가 맞지 않아")));
  });
}

test("관리자 탭 알림 안내는 기존 알림 켜기·설치 방법을 연결한다", () => {
  const renderAdmin = source.slice(source.indexOf("function renderAdmin()"), source.indexOf("// ── 시작"));
  for (const mode of ["group", "personal"]) for (const push of ["off", "on", "need-install", "denied"]) {
    const app = {};
    runInNewContext(`${renderAdmin}\nrenderAdmin()`, {
      S: { mode, push, admin: { stats: null } }, $: () => app, navHtml: () => "", adminFeedbackHtml: () => "",
    });
    assert.equal(app.innerHTML.includes("휴대폰 알림을 켜면 새 제보를 알림으로 받아요"), push !== "on");
    assert.equal(app.innerHTML.includes('data-action="push-on"'), push === "off");
    assert.equal(app.innerHTML.includes('data-action="install-guide"'), push === "need-install");
    if (push === "denied") assert.ok(app.innerHTML.includes("휴대폰 설정에서 이 앱의 알림을 허용해 주세요."));
  }
});

test("알림 클릭은 /?tab=admin으로 열고 두 모드 모두 시작 시 관리자 탭을 선택한다", async () => {
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  let handler;
  const start = source.slice(source.indexOf("async function start()"), source.lastIndexOf("start();"));
  for (const existing of [false, true]) {
    let opened, closed = false, job;
    const client = { navigate: path => { opened = path; }, focus() {} };
    // self는 콜백이 실행될 때 참조하므로 실제 클릭 처리와 같은 전역을 둔다.
    const context = { self: { addEventListener: (type, fn) => { if (type === "notificationclick") handler = fn; }, clients: {
      matchAll: async () => existing ? [client] : [], openWindow: path => { opened = path; },
    } } };
    runInNewContext(sw, context);
    handler({ notification: { data: { url: "/?tab=admin" }, close: () => { closed = true; } }, waitUntil: p => { job = p; } });
    await job;
    assert.equal(closed, true);
    assert.equal(opened, "/?tab=admin");
    for (const mode of ["group", "personal"]) {
      const saved = new Map([["adminCode", "c"]]);
      const S = { token: "token", mode, tab: "today" };
      const rendered = [];
      await runInNewContext(`${navigationCode}\n${start}\nstart()`, {
        S, navigator: {}, location: { search: opened.slice(1) }, URLSearchParams,
        TAB_NAMES: { today: "매일", admin: "관리자" },
        store: { get: k => saved.get(k), set: (k, v) => saved.set(k, v) },
        history: { replaceState() {} }, fetch: async () => ({ json: async () => ({ mode }) }),
        render: () => rendered.push(S.tab), autoInstallGuide() {}, loadState: async () => {},
        detectPush: async () => {}, autoCatchUpAsk() {}, hasAdmin: () => true, loadAdmin() {}, toast() {},
      });
      assert.equal(S.tab, "admin");
      assert.equal(saved.get("tab"), "admin");
      assert.ok(rendered.every(tab => tab === "admin"));
    }
  }
});
