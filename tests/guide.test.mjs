// 성경 길잡이 자료: 66권·구간 이름이 앱의 다른 자료와 맞는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { BOOK_NAMES } from "../public/shared/bible.js";
import { EOSEONG } from "../public/shared/eoseong.js";
import { BOOK_GROUPS, BOOK_GUIDE, CANON, ERAS } from "../public/shared/guide.js";
import { abbrBook, BOOK_ABBR, chronoOrder, EOSEONG120 } from "../public/shared/eoseong120.js";

test("120일 읽기표는 DAY 1~120, 본문 462개이며 확정 원본의 문자열·순서를 보존한다", () => {
  assert.deepEqual(EOSEONG120.map(({ day }) => day), Array.from({ length: 120 }, (_, i) => i + 1));
  assert.ok(EOSEONG120.every(({ items }) => Array.isArray(items) && items.length > 0));
  assert.equal(EOSEONG120.reduce((n, { items }) => n + items.length, 0), 462);
  assert.deepEqual(EOSEONG120[0].items, ["창 1-11장"]);
  assert.equal(EOSEONG120[100].items[0], "요 17장");
  assert.deepEqual(EOSEONG120[119].items, ["계 15-22장"]);
  // 사람이 사진과 대조해 확정한 eoseong120.json의 전체 내용. 외부 파일 없이도 변경을 감지한다.
  assert.equal(createHash("sha256").update(JSON.stringify(EOSEONG120)).digest("hex"),
    "fed3d7af64b3d3166a133b948ddc04ad42a9ab572eddf4a41a55fa58e0586bb0");
});

test("읽기표의 모든 약자는 정경 책 이름과 책 배경으로 연결된다", () => {
  assert.deepEqual(Object.values(BOOK_ABBR).sort(), [...CANON].sort());
  for (const { day, items } of EOSEONG120) for (const item of items) {
    assert.equal(typeof item, "string");
    const abbr = item.match(/^\(?([가-힣]+)\s/)[1];
    assert.ok(Object.hasOwn(BOOK_ABBR, abbr), `DAY ${day}: ${item}`);
    assert.ok(CANON.includes(BOOK_ABBR[abbr]), item);
    assert.equal(abbrBook(item), BOOK_ABBR[abbr], item);
    assert.ok(BOOK_GUIDE[abbrBook(item)], item);
  }
});

test("약자 찾기는 괄호·절 표기를 처리하고, 모르는 약자는 null을 돌려준다", () => {
  assert.equal(abbrBook("창 1-11장"), "창세기");
  assert.equal(abbrBook("(시 56편)"), "시편");
  assert.equal(abbrBook("(눅 3:23b-38)"), "누가복음");
  assert.equal(abbrBook("  (라 1-6장)  "), "에스라");
  assert.equal(abbrBook("(더 1-10장)"), "에스더");
  for (const item of ["", "(없는책 1장)", "창세기 1장", "constructor", "__proto__", null, undefined]) assert.equal(abbrBook(item), null);
});

test("시간 순서는 DAY 경계를 넘어 이어지는 본문을 합치고 모든 범위를 ~로 표시한다", () => {
  const before = JSON.stringify(EOSEONG120);
  const order = chronoOrder();
  assert.deepEqual(order.map(({ testament }) => testament), ["구약", "신약"]);
  const [ot, nt] = order.map(({ items }) => items);
  for (const item of ["창 1~50장", "출 1~40장", "민 10~36장", "대하 1~36장", "(사 1~39장)", "(시 1~2편)", "(렘 46:1~49:33)"]) assert.ok(ot.includes(item), item);
  assert.equal(nt[0], "눅 1:1~38");
  assert.deepEqual(nt.slice(2, 8), ["눅 1:39~2:7", "마 1:1~17", "(눅 3:23b~38)", "눅 2:8~38", "마 2장", "눅 2:39~3:18"]);
  for (const item of ["눅 8:1~18", "요 1:29~4:2", "눅 10:17~11:13", "행 1:12~8:13", "행 11:19~15:35", "행 21:17~28장"]) assert.ok(nt.includes(item), item);
  for (const item of ["눅 8:1-3", "눅 8:4-18", "눅 8:1~3", "눅 8:4~18", "눅 1:39~3:18"]) assert.ok(!nt.includes(item), item);
  for (const item of [...ot, ...nt]) {
    assert.doesNotMatch(item, /-|DAY|120일/);
    assert.ok(BOOK_GUIDE[abbrBook(item)], item);
  }
  assert.equal(JSON.stringify(EOSEONG120), before);
  assert.deepEqual(chronoOrder(), order); // 호출 결과에 이전 병합 상태가 남지 않는다.
});

test("병합은 바로 이웃한 동일 책·괄호 상태의 연속 범위만 허용하고 반절·빈틈·역순은 보존한다", () => {
  const cases = [
    [["창 1-2장", "창 3:1-5"], ["창 1:1~3:5"]],
    [["눅 1:79-80", "눅 2:1-7"], ["눅 1:79~2:7"]],
    [["출 4:18-31", "출 5-6장"], ["출 4:18~6장"]],
    [["눅 2:1-51", "눅 3:1-18"], ["눅 2:1~51", "눅 3:1~18"]],
    [["요 5:1-47", "요 6:1-15"], ["요 5:1~47", "요 6:1~15"]], // 표에 없는 장 끝은 추정 금지
    [["눅 8:1-3", "(눅 8:4-18)"], ["눅 8:1~3", "(눅 8:4~18)"]],
    [["(눅 8:1-3)", "눅 8:4-18"], ["(눅 8:1~3)", "눅 8:4~18"]],
    [["(눅 8:1-3)", "(눅 8:4-18)"], ["(눅 8:1~18)"]],
    [["눅 8:1-3", "요 1:1-3", "눅 8:4-18"], ["눅 8:1~3", "요 1:1~3", "눅 8:4~18"]],
    [["눅 8:1-3", "눅 8:5-18"], ["눅 8:1~3", "눅 8:5~18"]],
    [["눅 8:4-18", "눅 8:1-3"], ["눅 8:4~18", "눅 8:1~3"]],
    [["눅 8:1-4", "눅 8:4-18"], ["눅 8:1~4", "눅 8:4~18"]],
    [["눅 3:1-23a", "눅 3:23b-38"], ["눅 3:1~23a", "눅 3:23b~38"]],
    [["행 18:24-19:1a", "행 19:1b-22"], ["행 18:24~19:1a", "행 19:1b~22"]],
    [["시 1-2편", "시 3편"], ["시 1~3편"]],
  ];
  for (const [items, expected] of cases) {
    assert.deepEqual(chronoOrder([{ items }]).flatMap((g) => g.items), expected, items.join(", "));
  }
  const result = chronoOrder([{ items: ["창 1장", "눅 1:1-4", "창 2장"] }]);
  assert.deepEqual(result[0].items, ["창 1장", "창 2장"]); // 다른 구약/신약 항목을 건너뛰어 병합하지 않는다.
});

test("결과의 구성 원소는 원본 462개를 순서·범위·괄호·반절 손실 없이 정확히 한 번씩 포함한다", () => {
  // 결과를 원본 항목과 차례로 대조한다. 장 끝의 실제 절 수가 확인된 경우만 동등하게 취급한다.
  const lastVerses = {
    눅: { 1: 80, 2: 52, 10: 42 }, 요: { 1: 51, 2: 25, 3: 36, 10: 42 },
    행: { 1: 26, 11: 30, 21: 40 }, 출: { 4: 31 }, 민: { 20: 29 },
    대하: { 36: 23 }, 왕하: { 15: 38 }, 사: { 4: 6 },
  };
  const parse = (text) => {
    const match = text.match(/^\(?([가-힣]+) (\d+)(?::(\d+))?(?:[-~](\d+)(?::(\d+))?)?([장편])?\)?$/);
    assert.ok(match, text);
    const [, book, c, v, to, toV, unit] = match;
    const endChapter = Number(toV || unit || !v ? to ?? c : c);
    const endVerse = toV ? Number(toV) : to && v && !unit ? Number(to) : !to && v ? Number(v) : null;
    return {
      book, parenthesized: text.startsWith("("), start: [Number(c), Number(v ?? 1)],
      end: [endChapter, endVerse === null || endVerse === lastVerses[book]?.[endChapter] ? Infinity : endVerse],
    };
  };
  let total = 0;
  const counts = [];
  for (const [groupIndex, { items }] of chronoOrder().entries()) {
    const originals = EOSEONG120.slice(groupIndex === 0 ? 0 : 94, groupIndex === 0 ? 94 : 120).flatMap((r) => r.items);
    let cursor = 0;
    for (const item of items) {
      const start = cursor;
      assert.ok(cursor < originals.length, item);
      if (/[ab]/.test(item)) {
        assert.equal(item, originals[cursor++].replaceAll("-", "~"));
      } else {
        const merged = parse(item);
        assert.deepEqual(parse(originals[cursor]).start, merged.start, item);
        let previous;
        for (;;) {
          assert.ok(cursor < originals.length, item);
          const part = parse(originals[cursor++]);
          assert.equal(part.book, merged.book, item);
          assert.equal(part.parenthesized, merged.parenthesized, item);
          if (previous) {
            const [c, v] = previous.end, [nextC, nextV] = part.start;
            assert.ok(c === nextC && v + 1 === nextV || v === Infinity && c + 1 === nextC && nextV === 1, item);
          }
          if (part.end[0] === merged.end[0] && part.end[1] === merged.end[1]) break;
          previous = part;
        }
      }
      counts.push(cursor - start);
    }
    assert.equal(cursor, originals.length);
    total += cursor;
  }
  assert.equal(total, 462);
  assert.equal(counts.reduce((sum, n) => sum + n, 0), 462);
});

test("시간 순서 화면은 구약·신약 카드와 배경 버튼만 표시하며 DAY 안내를 제거한다", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const guide = source.slice(source.indexOf("const guideBookOf ="), source.indexOf("// ── 화면: 설정"));
  for (const mode of ["group", "personal"]) {
    const app = { innerHTML: "" };
    let sheet;
    runInNewContext(`${guide}\nrenderGuide(); openBookGuide(abbrBook("(눅 3:23b~38)"));`, {
      S: { mode }, store: { get: () => "order" }, $: () => app,
      esc: (value) => String(value), navHtml: () => "", openSheet: (html) => { sheet = html; },
      CANON, BOOK_GROUPS, BOOK_GUIDE, ERAS, abbrBook, chronoOrder,
    });
    assert.match(app.innerHTML, /「어성경 핸드북」의 시간 순서예요\. 괄호 표기는 핸드북 그대로예요\. 본문을 누르면 그 책의 배경을 볼 수 있어요\./);
    assert.doesNotMatch(app.innerHTML, /DAY|120일|gorder-day|gorder-no|›/);
    assert.equal((app.innerHTML.match(/class="card gorder"/g) || []).length, 2);
    assert.match(app.innerHTML, /<h2 class="section">구약<\/h2>/);
    assert.match(app.innerHTML, /<h2 class="section">신약<\/h2>/);
    for (const item of chronoOrder().flatMap((g) => g.items)) {
      const cls = `gbook gorder-chip${item.startsWith("(") ? " muted" : ""}`;
      assert.ok(app.innerHTML.includes(`<button class="${cls}" type="button" data-action="book-guide" data-book="${abbrBook(item)}">${item}</button>`), item);
    }
    assert.match(sheet, /<h3>누가복음<\/h3>/);
  }
});

test("구간은 어성경 순서와 같고, 66권 배경이 모두 있다", () => {
  assert.deepEqual(ERAS.map((e) => e.title), EOSEONG.map(([t]) => t));
  assert.equal(CANON.length, 66);
  assert.deepEqual([...CANON].sort(), [...BOOK_NAMES].sort());
  assert.deepEqual(Object.keys(BOOK_GUIDE).sort(), [...BOOK_NAMES].sort());
  const titles = new Set(ERAS.map((e) => e.title));
  for (const [name, g] of Object.entries(BOOK_GUIDE)) {
    assert.ok(g.eras.length && g.eras.every((t) => titles.has(t)), name);
    for (const k of ["years", "author", "audience", "message"]) assert.ok(g[k]?.trim(), `${name}.${k}`);
    assert.ok(g.tips.length >= 2, `${name}.tips`);
  }
});

test("책의 구간은 어성경에서 실제로 그 책이 나오는 구간이다", () => {
  for (const [title, units] of EOSEONG) {
    for (const u of units) {
      const book = typeof u === "string" ? u : u[0];
      assert.ok(BOOK_GUIDE[book].eras.includes(title), `${book} → ${title}`);
    }
  }
});

test("구간의 책 이름은 정경 책 이름으로 시작한다", () => {
  for (const e of ERAS) for (const b of e.books) assert.ok(CANON.some((n) => b === n || b.startsWith(`${n} `)), `${e.title}: ${b}`);
});

test("66권 분류와 '교회' 구간 묶음이 빠짐·겹침 없이 맞다", async () => {
  const { BOOK_GROUPS } = await import("../public/shared/guide.js");
  const all = BOOK_GROUPS.flatMap(([, , b]) => b);
  assert.deepEqual(all, CANON);
  assert.equal(BOOK_GROUPS.find(([, t]) => t === "바울서신")[2].length, 13);
  const church = ERAS.find((e) => e.title === "교회");
  const grouped = church.groups.flatMap((g) => g.books);
  assert.deepEqual([...grouped].sort(), [...church.books].sort());
});
