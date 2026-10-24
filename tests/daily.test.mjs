// 실제 앱 전체를 브라우저 최소 환경에서 실행해 두 모드의 탐색·저장·테마를 검사한다.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext, runInNewContext } from "node:vm";
import * as bible from "../public/shared/bible.js";
import * as roadmaps from "../public/shared/roadmaps.js";
import * as flow from "../public/shared/guide-flow.js";
import * as guide from "../public/shared/guide.js";
import * as order from "../public/shared/eoseong120.js";
import * as notices from "../public/shared/notices.js";
import * as videos from "../public/shared/videos.js";
import worker from "../worker/index.js";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const executable = source.replace(/^import[\s\S]*?from "[^"]+";\n/gm, "").replace(/\nstart\(\);\s*$/, "");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const plan = bible.buildDefaultPlan(3).slice(0, 12);
function app(mode, saved = {}, dark = false, search = "") {
  const storage = new Map(Object.entries({ mode, ...saved })), events = {}, mediaEvents = {};
  const attrs = new Map(), meta = new Map(), jumps = [], frames = [], timers = [], nodes = new Map();
  const screen = { innerHTML: "", classList: { toggle() {} } };
  const state = {
    me: { name: "미리보기", joinDay: 2, morning: "06:30", lunch: "12:30", evening: "21:00" },
    mode, plan, startDate: "2026-10-01", today: "2026-10-03", checks: {}, roadmap: "flow397", noticeSeen: 999,
  };
  const media = { matches: dark, addEventListener: (type, fn) => { mediaEvents[type] = fn; } };
  const localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: k => storage.delete(k) };
  const root = { setAttribute: (k, v) => attrs.set(k, v), removeAttribute: k => attrs.delete(k), style: { setProperty() {} } };
  const document = {
    documentElement: root, visibilityState: "hidden",
    querySelector: sel => nodes.has(sel) ? nodes.get(sel) : sel === "#app" ? screen : sel === 'meta[name="theme-color"]' ? { setAttribute: (k, v) => meta.set(k, v) }
      : sel.startsWith("#day-") ? { scrollIntoView: options => jumps.push({ sel, ...options }) } : null,
    addEventListener: (type, fn) => { (events[type] ||= []).push(fn); },
  };
  const context = createContext({
    ...bible, ...roadmaps, ...guide, ...flow, ...order, ...notices, ...videos, celebrate() {},
    localStorage, document, navigator: { userAgent: "test", platform: "test", standalone: true },
    window: { matchMedia: query => query === "(prefers-color-scheme: dark)" ? media : { matches: false }, addEventListener() {}, scrollTo() {} },
    location: { search }, history: { replaceState() {} }, URLSearchParams,
    requestAnimationFrame: fn => frames.push(fn), setInterval() {}, clearInterval() {}, setTimeout: (fn, ms) => timers.push({ fn, ms }), clearTimeout() {},
    fetch: async path => ({ ok: true, status: 200, json: async () => path === "/api/config" ? { mode } : state }),
  });
  runInContext(executable, context);
  const S = runInContext("S", context);
  Object.assign(S, state, { token: saved.token || "test", loaded: true, checks: new Map(), push: "off" });
  const evaluate = code => runInContext(code, context);
  const click = async (action, data = {}) => {
    const el = { dataset: { action, ...data }, tagName: "BUTTON" };
    for (const handler of events.click) await handler({ target: { closest: selector => selector === "[data-action]" ? el : null } });
  };
  return { S, storage, screen, attrs, meta, media, mediaEvents, jumps, frames, timers, nodes, context, evaluate, click };
}

for (const mode of ["group", "personal"]) {
  test(`매일 (${mode}): 탭바 순서·이름·아이콘과 관리자 표시`, () => {
    const a = app(mode);
    const names = mode === "group" ? ["today", "together", "chat", "guide", "settings"] : ["today", "guide", "settings"];
    for (const admin of [false, true]) {
      if (admin) a.storage.set("adminCode", "test");
      const nav = a.evaluate("navHtml()");
      assert.deepEqual([...nav.matchAll(/data-tab="([^"]+)"/g)].map(m => m[1]), [...names, ...(admin ? ["admin"] : [])]);
      assert.match(nav, /매일/);
      assert.doesNotMatch(nav, /data-tab="plan"/);
      assert.equal(a.evaluate('Object.hasOwn(TAB_NAMES, "plan")'), false);
      assert.match(nav, /stroke-width="1.8"/);
      assert.match(a.evaluate("ICONS.today"), /<rect.*M8.5 15l2.5 2.5 4.5-4.5/);
    }
  });

  test(`매일 (${mode}): 폴더 전환·오늘 전체 본문·일정·재그리기와 오늘 이동`, async () => {
    const a = app(mode);
    a.S.checks.set(6, new Set([bible.chapterKey(plan[5].chapters[0])]));
    a.evaluate("render()");
    assert.match(a.screen.innerHTML, /<header class="top"><h1>매일<\/h1>/);
    assert.equal((a.screen.innerHTML.match(/<h1>/g) || []).length, 1);
    assert.match(a.screen.innerHTML, /data-view="today" aria-current="page">오늘/);
    for (const text of ["DAY 3", "checks", "book-guide", "밀린 읽기", "미리 읽었어요", "push-on"]) assert.ok(a.screen.innerHTML.includes(text), text);
    if (mode === "group") assert.match(a.screen.innerHTML, /매일 > 일정/);
    await a.click("daily-view", { view: "plan" });
    assert.equal(a.S.tab, "today");
    assert.equal(a.S.dailyView, "plan");
    assert.equal(a.storage.get("dailyView"), "plan");
    assert.match(a.screen.innerHTML, /data-view="plan" aria-current="page">일정/);
    for (const action of ["jump-today", "bulk-edit", "history"]) assert.ok(a.screen.innerHTML.includes(`data-action="${action}"`), action);
    assert.equal((a.screen.innerHTML.match(/id="day-/g) || []).length, plan.length);
    assert.match(a.screen.innerHTML, /전체 일정 · 0 \/ 12일 완료/);
    assert.equal(a.frames.length, 1);
    a.frames.shift()();
    assert.deepEqual(a.jumps.map(j => [j.sel, j.behavior]), [["#day-3", "auto"]]);
    a.evaluate("render()");
    assert.equal(a.frames.length, 0); // 체크·새로고침으로 다시 그릴 때 위치를 뺏지 않는다.
    await a.click("jump-today");
    assert.equal(a.jumps.at(-1).behavior, "smooth");
    await a.click("tab", { tab: "guide" });
    await a.click("tab", { tab: "today" });
    assert.equal(a.S.dailyView, "plan");
    await a.click("daily-view", { view: "today" });
    assert.match(a.screen.innerHTML, /class="checks"/);
    assert.doesNotMatch(a.screen.innerHTML, /class="plan-head"/);
    assert.equal(a.storage.get("dailyView"), "today");
    assert.equal(app(mode, Object.fromEntries(a.storage)).S.dailyView, "today");
  });

  test(`매일 (${mode}): 예전 plan 버튼·저장값과 새 dailyView 복원`, async () => {
    const old = app(mode, { tab: "plan", dailyView: "today" });
    assert.equal(old.S.tab, "today");
    assert.equal(old.S.dailyView, "plan");
    assert.equal(old.storage.get("tab"), "today");
    assert.equal(old.storage.get("dailyView"), "plan");
    old.evaluate("render()");
    assert.match(old.screen.innerHTML, /class="plan-head"/);
    const a = app(mode, { tab: "settings" });
    a.evaluate("render()");
    if (mode === "group") assert.match(a.screen.innerHTML, /data-tab="plan">전체 일정 보기 · 범위 바꾸기/);
    await a.click("tab", { tab: "plan" });
    assert.equal(a.S.tab, "today");
    assert.equal(a.S.dailyView, "plan");
    const next = app(mode, Object.fromEntries(a.storage));
    assert.equal(next.S.dailyView, "plan");
    next.evaluate("render()");
    assert.match(next.screen.innerHTML, /class="plan-head"/);
  });

  test(`매일 (${mode}): 시작 주소 ?tab=plan·today 우선 적용과 알림 오늘 이동`, async () => {
    for (const tab of ["plan", "today"]) {
      const a = app(mode, { token: "test", tab: "settings", dailyView: tab === "today" ? "plan" : "today" }, false, `?tab=${tab}`);
      await a.evaluate("start()");
      assert.equal(a.S.tab, "today");
      assert.equal(a.S.dailyView, tab);
      assert.equal(a.storage.get("tab"), "today");
      assert.equal(a.storage.get("dailyView"), tab);
      assert.ok(a.screen.innerHTML.includes(tab === "plan" ? 'class="plan-head"' : 'class="checks"'));
    }
  });

  test(`테마 (${mode}): 설정 세 칸·3종 적용과 저장·재시작`, async () => {
    const a = app(mode, { tab: "settings" });
    a.evaluate("render()");
    const chips = a.screen.innerHTML.match(/class="pick-chips theme-chips"[\s\S]*?<\/div>/)[0];
    assert.deepEqual([...chips.matchAll(/data-theme="([^"]+)"/g)].map(m => m[1]), ["auto", "light", "dark"]);
    assert.deepEqual([...chips.matchAll(/>(자동|밝게|어둡게)<\/button>/g)].map(m => m[1]), ["자동", "밝게", "어둡게"]);
    for (const dark of [false, true]) for (const theme of ["auto", "light", "dark"]) {
      a.media.matches = dark;
      await a.click("theme", { theme });
      assert.equal(a.S.theme, theme);
      assert.equal(a.storage.get("theme"), theme);
      assert.equal(a.attrs.get("data-theme"), theme === "auto" ? undefined : theme);
      assert.equal(a.meta.get("content"), theme === "dark" || theme === "auto" && dark ? "#1b1a17" : "#f7f2e9");
      assert.match(a.screen.innerHTML, new RegExp(`data-theme="${theme}" aria-pressed="true"`));
      const restarted = app(mode, Object.fromEntries(a.storage), dark);
      assert.equal(restarted.S.theme, theme);
      assert.equal(restarted.attrs.get("data-theme"), a.attrs.get("data-theme"));
      assert.equal(restarted.meta.get("content"), a.meta.get("content"));
    }
  });

  test(`테마 (${mode}): 자동의 시스템 변경·수동 우선·잘못된 저장값`, async () => {
    const a = app(mode, { tab: "settings", theme: "invalid" });
    assert.equal(a.S.theme, "auto");
    assert.equal(a.attrs.has("data-theme"), false);
    a.media.matches = true;
    a.mediaEvents.change();
    assert.equal(a.meta.get("content"), "#1b1a17");
    for (const theme of ["light", "dark"]) {
      await a.click("theme", { theme });
      a.media.matches = theme === "light";
      a.mediaEvents.change();
      assert.equal(a.attrs.get("data-theme"), theme);
      assert.equal(a.meta.get("content"), theme === "dark" ? "#1b1a17" : "#f7f2e9");
    }
    await a.click("theme", { theme: "invalid" });
    assert.equal(a.S.theme, "dark");
  });
}

test("개인 달력형 일정은 매일 안에서도 표 편집·변경 기록을 제공하지 않는다", async () => {
  const a = app("personal");
  a.S.roadmap = "mcheyne";
  await a.click("daily-view", { view: "plan" });
  assert.match(a.screen.innerHTML, /data-action="jump-today"/);
  assert.doesNotMatch(a.screen.innerHTML, /data-action="bulk-edit"|data-action="history"/);
});

test("첫 화면 테마 스크립트는 CSS 앞에서 실제 저장 키를 읽고 저장 불가 환경도 처리한다", () => {
  assert.equal((html.match(/<meta name="theme-color"/g) || []).length, 1);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(html.indexOf("<script>") < html.indexOf('href="/style.css"'));
  for (const theme of [null, "auto", "light", "dark", "invalid", "throw"]) for (const dark of [false, true]) {
    const attrs = new Map(), meta = new Map();
    runInNewContext(script, {
      localStorage: { getItem(key) { assert.equal(key, "theme"); if (theme === "throw") throw Error("blocked"); return theme; } },
      document: { documentElement: { setAttribute: (k, v) => attrs.set(k, v) }, querySelector: () => ({ setAttribute: (k, v) => meta.set(k, v) }) },
      matchMedia: () => ({ matches: dark }),
    });
    assert.equal(attrs.get("data-theme"), ["light", "dark"].includes(theme) ? theme : undefined);
    assert.equal(meta.get("content"), theme === "dark" || theme !== "light" && dark ? "#1b1a17" : "#f7f2e9");
  }
});

test("서비스워커 v54: 알림 작은 배지는 badge-96·앱 아이콘 유지·오프라인 포함", async () => {
  const handlers = {}, notifications = [], shells = [];
  runInNewContext(sw, {
    self: { addEventListener: (type, fn) => { handlers[type] = fn; }, skipWaiting() {}, registration: { showNotification: (title, options) => notifications.push({ title, options }) } },
    caches: { open: async name => ({ addAll: async paths => shells.push({ name, paths }) }) },
  });
  let pending;
  handlers.install({ waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(shells[0].name, "malsseum-v55");
  assert.ok(shells[0].paths.includes("/icons/badge-96.png"));
  handlers.push({ data: { json: () => ({ title: "오늘", url: "/?tab=today" }) }, waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(notifications[0].options.badge, "/icons/badge-96.png");
  assert.equal(notifications[0].options.icon, "/icons/icon-192.png");
  assert.equal(notifications[0].options.data.url, "/?tab=today");
});

test("두 모드의 badge 경로는 Worker가 각 앱의 실제 PNG로 연결한다", async () => {
  for (const mode of ["group", "personal"]) {
    const png = readFileSync(new URL(`../public/${mode === "personal" ? "personal/" : ""}icons/badge-96.png`, import.meta.url));
    let requested;
    const response = await worker.fetch(new Request("https://app.test/icons/badge-96.png"), {
      ...(mode === "personal" ? { MODE: mode } : {}),
      ASSETS: { fetch: req => { requested = new URL(req.url).pathname; return new Response(png, { headers: { "Content-Type": "image/png" } }); } },
    });
    assert.equal(requested, mode === "personal" ? "/personal/icons/badge-96.png" : "/icons/badge-96.png");
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
    assert.equal(png.readUInt32BE(16), 96);
    assert.equal(png.readUInt32BE(20), 96);
  }
});

// 실제 행 순서를 쓰는 최소 DOM으로 열기·강조 대상·렌더 후 이동·강조 해제를 검사한다.
function flowDom(a) {
  const targets = [];
  const target = () => {
    const classes = new Set();
    const node = { classes, classList: { add: v => classes.add(v), remove: v => classes.delete(v) }, scrollIntoView: options => a.jumps.push({ ...options }) };
    targets.push(node);
    return node;
  };
  const eras = a.evaluate("orderEras()").map(({ title, rows }) => {
    const fold = { open: false };
    const parts = (guide.CHRONO_PARTS[title] || []).map(() => {
      const label = target();
      return { open: false, label, querySelector: () => label };
    });
    const domRows = rows.map(({ main, also }) => {
      const refs = [main, ...also].filter(Boolean).map(target);
      return { refs, querySelectorAll: () => refs };
    });
    return { fold, parts, rows: domRows, querySelector: () => fold, querySelectorAll: sel => sel === ".gorder-part" ? parts : domRows };
  });
  const timeline = { querySelectorAll: () => eras };
  a.nodes.set(".gorder-timeline", timeline);
  return { eras, targets };
}

for (const mode of ["group", "personal"]) {
  test(`시대 흐름 (${mode}): 오늘 버튼 1개·세례와 시험/갈릴리 구간 열기·중앙 이동·강조 해제`, async () => {
    const a = app(mode);
    a.S.plan = [{ day: 1, chapters: [["누가복음", 4], ["누가복음", 5], ["누가복음", 6]] }];
    a.S.today = a.S.startDate;
    a.evaluate("render()");
    assert.equal((a.screen.innerHTML.match(/data-action="today-flow"/g) || []).length, 1);
    assert.match(a.screen.innerHTML, /class="book-info">[\s\S]*data-action="book-guide"[\s\S]*class="link-btn guide-flow-link"/);
    assert.match(a.screen.innerHTML, /aria-hidden="true">[\s\S]*시대 흐름 보기/);
    const dom = flowDom(a);
    await a.click("today-flow");
    assert.equal(a.S.tab, "guide");
    assert.equal(a.storage.get("tab"), "guide");
    assert.deepEqual(dom.eras.flatMap((e, i) => e.fold.open ? [i] : []), [8]);
    assert.deepEqual(dom.eras[8].parts.flatMap((p, i) => p.open ? [i] : []), [1, 3]);
    assert.equal(a.jumps.length, 0);
    a.frames.shift()();
    assert.equal(a.jumps.length, 0);
    a.frames.shift()();
    assert.deepEqual(a.jumps, [{ behavior: "smooth", block: "center" }]);
    const highlighted = dom.targets.filter(n => n.classes.has("gorder-highlight"));
    assert.equal(highlighted.length, 2);
    assert.ok(highlighted.includes(dom.eras[8].parts[1].label));
    assert.ok(highlighted.includes(dom.eras[8].parts[3].label));
    const cleanup = a.timers.find(t => t.ms === 3100);
    assert.ok(cleanup);
    cleanup.fn();
    assert.ok(highlighted.every(n => !n.classes.has("gorder-highlight")));
    await a.click("tab", { tab: "guide" });
    assert.doesNotMatch(a.screen.innerHTML, /<details[^>]*\bopen\b|gorder-highlight/);
  });

  test(`시대 흐름 (${mode}): 하위 구간 없는 큰 줄기/함께 읽기와 움직임 줄이기`, async () => {
    const a = app(mode);
    a.S.plan = [{ day: 1, chapters: [["창세기", 5], ["시편", 34]] }];
    a.S.today = a.S.startDate;
    runInContext('window.matchMedia = () => ({ matches: true })', a.context);
    const dom = flowDom(a);
    await a.click("today-flow");
    a.frames.shift()(); a.frames.shift()();
    assert.deepEqual(a.jumps, [{ behavior: "auto", block: "center" }]);
    assert.ok(dom.eras[0].rows[0].refs[0].classes.has("gorder-highlight"));
    assert.equal(dom.targets.filter(n => n.classes.has("gorder-highlight")).length, 2);
    assert.ok(dom.eras[3].rows.some(r => r.refs.slice(1).some(n => n.classes.has("gorder-highlight"))));
    assert.ok(dom.eras.every(e => e.parts.every(p => !p.open)));
  });

  test(`시대 흐름 (${mode}): 불일치 토스트와 이동 전 탭 이탈`, async () => {
    const a = app(mode), toast = { textContent: "", classList: { add() {}, remove() {} } };
    a.nodes.set("#toast", toast);
    a.S.plan = [{ day: 1, chapters: [["없는 책", 1]] }];
    a.S.today = a.S.startDate;
    const dom = flowDom(a);
    await a.click("today-flow");
    assert.equal(a.S.tab, "guide");
    assert.equal(toast.textContent, "이 본문은 시간 순서표에서 찾지 못했어요");
    assert.equal(a.frames.length, 0);
    assert.ok(dom.eras.every(e => !e.fold.open));
    a.S.plan[0].chapters = [["누가복음", 4]];
    await a.click("today-flow");
    await a.click("tab", { tab: "today" });
    a.frames.shift()(); a.frames.shift()();
    assert.equal(a.jumps.length, 0);
    assert.ok(dom.targets.every(n => !n.classes.has("gorder-highlight")));
  });
}
