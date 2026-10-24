import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { resolveBook } from "../public/shared/bible.js";
import { BOOK_MORE } from "../public/shared/book-more.js";
import { TAGS, DISCIPLES_INTRO, DISCIPLES, SAME_NAMES, AFTER_ASCENSION } from "../public/shared/disciples.js";
import { BOOK_GROUPS, BOOK_GUIDE, CANON, ERAS, CHRONO_PARTS } from "../public/shared/guide.js";
import { abbrBook, chronoTimeline, fullRef } from "../public/shared/eoseong120.js";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const guide = source.slice(source.indexOf("const GORDER_COLORS ="), source.indexOf("// ── 화면: 설정"));
const clicks = source.slice(source.lastIndexOf('document.addEventListener("click"'), source.indexOf('document.addEventListener("change"'));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
function screen(mode) {
  const root = { innerHTML: "" }, app = { innerHTML: "" };
  let click;
  const context = {
    S: { mode, guideTab: "flow" }, store: { set() {} }, window: { scrollTo() {} }, render: () => runInNewContext("renderGuide()", context), esc, BOOK_MORE, TAGS, DISCIPLES_INTRO, DISCIPLES, SAME_NAMES, AFTER_ASCENSION,
    BOOK_GROUPS, BOOK_GUIDE, ERAS, CHRONO_PARTS, abbrBook, resolveBook, chronoTimeline, fullRef,
    $: sel => sel === "#app" ? app : root, navHtml: () => "",
    document: { addEventListener: (type, fn) => { if (type === "click") click = fn; } },
  };
  const sheet = source.slice(source.indexOf("function openSheet(html)"), source.indexOf("let openDayNo ="));
  runInNewContext(`${guide}\n${sheet}\n${clicks}\nrenderGuide();`, context);
  return { app, root, context, press: dataset => click({ target: { closest: () => ({ dataset }) } }) };
}

test("BOOK_MORE는 정경 66권과 일치하고 필수 내용·연결 본문이 모두 있다", () => {
  assert.deepEqual(Object.keys(BOOK_MORE).sort(), [...CANON].sort());
  for (const [book, m] of Object.entries(BOOK_MORE)) {
    for (const field of ["oneLine", "setting"]) assert.ok(typeof m[field] === "string" && m[field].trim(), `${book}.${field}`);
    for (const values of [m.flow, Array.isArray(m.question) ? m.question : [m.question]]) {
      assert.ok(values.length);
      for (const value of values) assert.ok(typeof value === "string" && value.trim(), book);
    }
    assert.ok(m.connect.length);
    for (const { ref, why } of m.connect) {
      assert.ok(ref.trim() && why.trim(), book);
      assert.ok(BOOK_GUIDE[abbrBook(ref) || resolveBook(ref.split(/\s+/)[0])], `${book}: ${ref}`);
    }
    if (m.views) assert.equal(typeof m.views, "string");
  }
});

for (const mode of ["group", "personal"]) {
  test(`${mode}: 66권의 한 줄 소개·더 알아보기 원문과 순서, 기본 닫힘`, async () => {
    const s = screen(mode);
    for (const book of CANON) {
      await s.press({ action: "book-guide", book });
      const html = s.root.innerHTML, m = BOOK_MORE[book], old = BOOK_GUIDE[book];
      assert.ok(html.includes(`<h3>${book}</h3>\n    <p class="book-one-line">${esc(m.oneLine)}</p>`));
      assert.match(html, /<details class="book-more"><summary>더 알아보기<\/summary>/);
      const labels = ["알아 두면 좋아요", "더 알아보기", "당시 상황", "책의 흐름", "함께 볼 본문", "읽으며 생각할 질문", ...(m.views ? ["견해 차이"] : [])];
      let prev = -1;
      for (const label of labels) { const i = html.indexOf(label); assert.ok(i > prev, `${book}: ${label}`); prev = i; }
      for (const text of [old.years, old.author, old.audience, old.message, ...old.tips, m.setting, ...m.flow, ...(Array.isArray(m.question) ? m.question : [m.question]), ...m.connect.flatMap(c => [c.ref, c.why]), ...(m.views ? [m.views] : [])]) assert.ok(html.includes(esc(text)), `${book}: ${text}`);
      assert.equal(html.includes('class="book-views"'), !!m.views);
    }
  });

  test(`${mode}: 로마서 행 18:2 클릭은 사도행전으로 교체하고 미해석 ref는 글자로 표시`, async () => {
    const s = screen(mode);
    await s.press({ action: "book-guide", book: "로마서" });
    const button = s.root.innerHTML.match(/data-action="book-guide" data-book="([^"]+)"><b>행 18:2<\/b><\/button>/);
    assert.ok(button);
    assert.equal(button[1], "사도행전");
    await s.press({ action: "book-guide", book: button[1] });
    assert.ok(s.root.innerHTML.includes('<h3>사도행전</h3>'));
    assert.ok(!s.root.innerHTML.includes('<h3>로마서</h3>'));
    assert.match(runInNewContext('bookConnectRef("스 2:59~63")', s.context), /data-book="에스라"/);
    assert.equal(runInNewContext('bookConnectRef("미확인 1:1")', s.context), '<b>미확인 1:1</b>');
  });

  test(`${mode}: 인물 정보 전환·열두 제자 12명·태그·같은 이름 6묶음·본문 유지`, async () => {
    const s = screen(mode);
    assert.doesNotMatch(s.app.innerHTML, /guide-books|guide-resources|guide-disciples/);
    await s.press({ action: "guide-tab", guideTab: "people" });
    const html = s.app.innerHTML;
    // 인물 정보는 주제별 폴더(처음엔 닫힘): 열두 제자 / 헷갈리는 같은 이름. 범례는 폴더 밖 맨 위.
    assert.match(html, /<section class="disciples-guide" aria-label="인물 정보">\s*<p class="guide-legend">/);
    assert.deepEqual([...html.matchAll(/<details class="people-folder"><summary><b>([^<]+)<\/b>/g)].map(m => m[1]), ["열두 제자", "헷갈리는 같은 이름"]);
    assert.ok(html.indexOf('class="people-folder"') < html.indexOf('class="disciple-card"'));
    assert.doesNotMatch(html, /role="dialog"|close-sheet|gorder-timeline|class="gbook"/);
    assert.match(html, /표시: 성경·전통·일반적 견해·뜻풀이를 구분했어요\./);
    assert.doesNotMatch(html, /연대와 저자는/);
    assert.equal((html.match(/<details class="disciple-card">/g) || []).length, 12);
    assert.equal((html.match(/<details class="same-name-card">/g) || []).length, 6);
    assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/);
    for (const text of [DISCIPLES_INTRO.lists, DISCIPLES_INTRO.tip, ...Object.values(TAGS)]) assert.ok(html.includes(esc(text)));
    for (const kind of ["bible", "tradition", "common", "meaning"]) assert.ok(html.includes(`class="guide-tag ${kind}"`));
    for (const [i, d] of DISCIPLES.entries()) {
      assert.ok(html.includes(`<span class="disciple-number">${i + 1}</span><span><b>${esc(d.name)}</b><small class="disciple-english">${esc(d.english)}</small>`));
      for (const r of [...d.names, ...d.facts]) {
        for (const text of [r.name, r.text, r.refs, r.tag].filter(Boolean)) assert.ok(html.includes(esc(text)));
      }
    }
    assert.equal((html.match(/<h4>다른 이름<\/h4>/g) || []).length, DISCIPLES.filter(d => d.names.length).length);
    // 승천 이후 단락과 사도마다 '마지막'(성경·전통·후대 전승 구분)
    assert.match(html, /<h4 class="after-ascension-title">예수님 승천 이후<\/h4>/);
    assert.equal((html.match(/<details class="disciple-card after-card">/g) || []).length, AFTER_ASCENSION.length);
    for (const g of AFTER_ASCENSION) { assert.ok(html.includes(esc(g.title))); for (const p of g.points) assert.ok(html.includes(esc(p.text))); }
    assert.equal((html.match(/<h4>마지막<\/h4>/g) || []).length, DISCIPLES.filter(d => d.end?.length).length);
    assert.doesNotMatch(html, /후대 전승|guide-tag late/); // 운영자 지시: 후대 전승은 싣지 않는다
    for (const group of SAME_NAMES) for (const p of group.people) assert.ok(html.includes(`${esc(p.who)} <small class="disciple-refs">${esc(p.refs)}</small>`));
    await s.press({ action: "book-guide", book: "마태복음" });
    assert.match(s.root.innerHTML, /role="dialog"/);
    await s.press({ action: "close-sheet" });
    assert.equal(s.root.innerHTML, "");
    assert.equal(s.app.innerHTML, html);
  });
}

test("시트 내부 스크롤·휴대폰 버튼·oneLine·태그 스타일과 캐시 v57 오프라인 자료", async () => {
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /\.sheet\s*\{[^}]*max-height: 92vh; overflow-y: auto;/);
  assert.match(css, /\.book-one-line\s*\{[^}]*font-size: 15px;[^}]*font-weight: 500;[^}]*color: var\(--ink\)/);
  assert.match(css, /\.guide-folders button\s*\{[^}]*padding-inline: 4px;[^}]*font-size: 16px/);
  assert.doesNotMatch(css, /guide-find|guide-actions|guide-resource/);
  assert.match(css, /\.guide-tag\.meaning\s*\{[^}]*dashed var\(--line\)/);
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  let install, pending, cache, paths;
  runInNewContext(sw, { self: { addEventListener(type, fn) { if (type === "install") install = fn; }, skipWaiting() {} }, caches: { open: async name => { cache = name; return { addAll: async shell => { paths = shell; } }; } } });
  install({ waitUntil: p => { pending = p; } });
  await pending;
  assert.equal(cache, "malsseum-v60");
  for (const path of ["/shared/book-more.js", "/shared/disciples.js"]) assert.ok(paths.includes(path));
});
