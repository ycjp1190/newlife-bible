// 성경 길잡이 자료: 66권·구간 이름이 앱의 다른 자료와 맞는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { BOOK_MORE } from "../public/shared/book-more.js";
import { TAGS, DISCIPLES_INTRO, DISCIPLES, SAME_NAMES } from "../public/shared/disciples.js";
import { BOOK_NAMES, resolveBook } from "../public/shared/bible.js";
import { EOSEONG } from "../public/shared/eoseong.js";
import { BOOK_GROUPS, BOOK_GUIDE, CANON, ERAS, CHRONO_PARTS } from "../public/shared/guide.js";
import { abbrBook, BOOK_ABBR, chronoOrder, chronoTimeline, EOSEONG120, fullRef } from "../public/shared/eoseong120.js";

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

test("타임라인은 전체 병합 항목의 순서를 보존하고 구간을 앞으로만 진행한다", () => {
  const timeline = chronoTimeline();
  assert.equal(timeline.length, 12);
  assert.deepEqual(timeline.map(({ title }) => title), ERAS.map(({ title }) => title));
  const flattened = timeline.flatMap(({ rows }) => rows.flatMap(({ main, also }) => main === null ? also : [main, ...also]));
  assert.deepEqual(flattened, chronoOrder().flatMap(({ items }) => items));
  let previous = -1;
  for (const { title, years, rows } of timeline) {
    const era = ERAS.findIndex((e) => e.title === title);
    assert.ok(era > previous, title);
    assert.equal(years, ERAS[era].years);
    assert.ok(rows.length, title);
    for (const { main, also } of rows) {
      assert.ok(main === null || !main.startsWith("("));
      assert.ok(also.every((item) => item.startsWith("(")));
    }
    previous = era;
  }
  assert.equal(timeline[0].title, "시작과 족장");
  assert.equal(timeline[0].rows[0].main, "창 1~50장");
  assert.deepEqual(timeline[0].rows, [{ main: "창 1~50장", also: [] }]);
  assert.equal(timeline[1].title, "출애굽과 광야");
  assert.equal(timeline[1].rows[0].main, "출 1~40장");
  assert.deepEqual(timeline.find((e) => e.title === "포로기").rows, [
    { main: null, also: ["(단 1~12장)", "(겔 1~48장)"] },
  ]);
  assert.deepEqual(timeline.find((e) => e.title === "욥기").rows, [
    { main: null, also: ["(욥 1~42장)"] },
  ]);
  const united = timeline.find((e) => e.title === "통일왕국");
  assert.deepEqual(united.rows.find(({ main }) => main === "삼상 21장"), {
    main: "삼상 21장", also: ["(시 34편)", "(시 56편)"],
  });
  const chronicles = timeline.find((e) => e.title === ERAS[6].title);
  assert.equal(chronicles.rows[0].main, "대상 1~16장");
  // 역대기 구간의 시편도 앞서 나와 통일왕국에서 구간을 넘기지 않는다.
  assert.ok(united.rows.find(({ main }) => main === "삼상 24장").also.includes("(시 142편)"));
  assert.deepEqual(chronicles.rows[0].also, ["(시 105편)", "(시 73~89편)"]);
  // 사도행전 뒤에 나오는 복음서도 구간을 되돌리지 않는다.
  const church = timeline.find((e) => e.title === "교회");
  assert.deepEqual(church.rows.slice(0, 2).map(({ main }) => main), ["행 1:1~11", "마 28:16~20"]);
  assert.equal(timeline.at(-1).title, "새 하늘과 새 땅");
  assert.deepEqual(chronoTimeline(), timeline);
});

test("본문의 전체 책 이름 표시는 괄호만 빼고 범위·반절·장/편을 보존한다", () => {
  assert.equal(fullRef("(렘 46:1~49:33)"), "예레미야 46:1~49:33");
  assert.equal(fullRef("눅 3:21~23a"), "누가복음 3:21~23a");
  assert.equal(fullRef("삼상 21장"), "사무엘상 21장");
  assert.equal(fullRef("(시 34편)"), "시편 34편");
});

test("짧은 연대 12개와 예수님·교회 하위 구간 시작점은 확정 자료와 일치한다", () => {
  assert.deepEqual(ERAS.map(e => e.yearsShort), [
    ["창조 ~", "BC 1446"], ["BC 1446", "~ 1406"], ["BC 1406", "~ 1050"],
    ["BC 1050", "~ 930"], ["BC 930", "~ 586"], ["BC 605", "~ 538"],
    ["아담 ~", "귀환 이후"], ["BC 538", "~ 430"], ["연대", "미상"],
    ["BC 6~4", "~ AD 30", "또는 33"], ["AD 30", "~ 1세기 말"], ["AD 95", "기록"],
  ]);
  assert.deepEqual(Object.keys(CHRONO_PARTS), ["예수님", "교회"]);
  assert.deepEqual(CHRONO_PARTS["예수님"].map(p => p.from), ["눅 1:1~38", "눅 2:39~3:18", "요 1:29~4:2", "눅 4:14~30", "눅 8:1~18", "마 16:1~12", "요 7:1~10", "요 12:1~11", "눅 24:1~49"]);
  assert.deepEqual(CHRONO_PARTS["교회"].map(p => p.from), ["행 1:1~11", "행 8:26~40", "행 11:19~15:35", "행 15:36~41", "행 18:24~19:1a", "행 21:17~28장", "딤전 1~6장", "약 1~5장"]);
  for (const [title, parts] of Object.entries(CHRONO_PARTS)) {
    const rows = chronoTimeline().find(e => e.title === title).rows;
    for (const { from } of parts) assert.equal(rows.filter(r => r.main === from).length, 1, from);
  }
});

const partsClass = (title) => CHRONO_PARTS[title] ? 'class="gorder-part"' : 'class="gorder-row"';

test("시간 순서 화면은 11시대 접는 타임라인·왼쪽 연대·항상 보이는 함께 읽기·하위 구간과 전체 책 이름의 배경 버튼을 표시한다", () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const guide = source.slice(source.indexOf("const GORDER_COLORS ="), source.indexOf("// ── 화면: 설정"));
  for (const mode of ["group", "personal"]) {
    const app = { innerHTML: "" };
    let sheet;
    runInNewContext(`${guide}\nrenderGuide(); openBookGuide(abbrBook("(눅 3:23b~38)"));`, {
      S: { mode }, store: { get: () => "order" }, $: () => app,
      esc: (value) => String(value), navHtml: () => "", openSheet: (html) => { sheet = html; },
      CANON, BOOK_MORE, TAGS, DISCIPLES_INTRO, DISCIPLES, SAME_NAMES, BOOK_GROUPS, BOOK_GUIDE, ERAS, CHRONO_PARTS, abbrBook, resolveBook, chronoTimeline, fullRef,
    });
    assert.ok(app.innerHTML.includes("「어성경 핸드북」의 시간 순서예요. 연대는 대략이에요. 시대를 누르면 요약과 읽는 순서가 펼쳐져요. 굵은 줄은 큰 줄기, '함께 읽기'는 그 시기에 함께 읽는 본문이에요. 본문이나 책을 누르면 책 배경이 나와요."));
    assert.doesNotMatch(app.innerHTML, /DAY|120일|gorder-chip|gorder-items|괄호 표기|›/);
    assert.match(app.innerHTML, /<ol class="gorder-timeline">/);
    assert.doesNotMatch(source, /guideView|guide-view|guide-views/);
    assert.doesNotMatch(app.innerHTML, /guide-books|guide-resources|guide-disciples|66권 찾기|참고 자료/);
    assert.ok(!app.innerHTML.includes(ERAS.find(e => e.title === "욥기").summary));
    for (const group of ERAS.flatMap(e => e.groups || [])) {
      assert.ok(!app.innerHTML.includes(group.summary));
    }
    const eras = app.innerHTML.match(/<li class="gorder-era" style="--c:#[0-9a-f]{6}">[\s\S]*?(?=<li class="gorder-era"|<\/ol>)/g) || [];
    // 욥기는 따로 두지 않고 '시작과 족장'의 함께 읽기로 붙는다.
    const timeline = chronoTimeline();
    const job = timeline.find((e) => e.title === "욥기");
    const expected = timeline.filter((e) => e !== job);
    const firstLast = expected[0].rows.at(-1);
    expected[0] = { ...expected[0], rows: [...expected[0].rows.slice(0, -1), { ...firstLast, also: [...firstLast.also, ...job.rows.flatMap((r) => [r.main, ...r.also].filter(Boolean))] }] };
    assert.equal(expected.length, 11);
    assert.deepEqual(expected[0].rows, [{ main: "창 1~50장", also: ["(욥 1~42장)"] }]);
    assert.doesNotMatch(app.innerHTML, /<h2 class="gorder-title">욥기<\/h2>/);
    assert.equal(eras.length, 11);
    assert.equal(new Set(eras.map((html) => html.match(/--c:(#[0-9a-f]{6})/)[1])).size, 11);
    assert.equal((app.innerHTML.match(/<details class="gorder-fold">/g) || []).length, 11);
    assert.doesNotMatch(app.innerHTML, /<details[^>]*\bopen\b/);
    for (const [i, { title, years, rows }] of expected.entries()) {
      const era = eras[i];
      const no = String(i + 1).padStart(2, "0");
      assert.ok(era.includes(`<span class="gorder-node" aria-hidden="true">${no}</span>`));
      assert.ok(era.includes(`<h2 class="gorder-title">${title}</h2>`));
      assert.ok(era.includes(`<span class="gorder-years" aria-label="${years}">${ERAS.find((e) => e.title === title).yearsShort.join("<br>")}</span>`));
      const fold = era.slice(era.indexOf('<details class="gorder-fold">'));
      assert.doesNotMatch(fold, /gorder-years/);
      const data = ERAS.find(e => e.title === title);
      assert.ok(fold.includes(`<p class="gorder-summary">${data.summary}</p>`));
      const people = fold.match(/<p class="guide-people">([\s\S]*?)<\/p>/)[1];
      assert.deepEqual([...people.matchAll(/<span class="chip">([^<]+)<\/span>/g)].map(m => m[1]), data.people);
      assert.ok(fold.indexOf('class="gorder-summary"') < fold.indexOf('class="guide-people"'));
      assert.ok(fold.indexOf('class="guide-people"') < fold.indexOf(partsClass(title)));

      assert.ok(era.indexOf('class="gorder-years"') < era.indexOf('class="gorder-node"'));
      assert.ok(era.indexOf('class="gorder-node"') < era.indexOf('class="gorder-fold"'));
      const mainCount = rows.filter(({ main }) => main).length;
      const alsoCount = rows.reduce((n, { also }) => n + also.length, 0);
      const counts = [mainCount ? `큰 줄기 ${mainCount}` : "", alsoCount ? `함께 읽기 ${alsoCount}` : ""].filter(Boolean).join(" · ");
      assert.ok(era.includes(`<span class="gorder-count">${counts}</span>`));
      assert.doesNotMatch(era, /<details class="gorder-also"|gorder-direct/);
      assert.equal((era.match(/<div class="gorder-also">/g) || []).length, rows.filter(({ also }) => also.length).length);
      const parts = CHRONO_PARTS[title];
      const renderedParts = era.match(/<details class="gorder-part">[\s\S]*?(?=<details class="gorder-part">|$)/g) || [];
      assert.equal(renderedParts.length, parts?.length || 0);
      if (parts) {
        const starts = parts.map(({ from }) => rows.findIndex(({ main }) => main === from));
        const partition = [];
        for (const [j, part] of parts.entries()) {
          assert.ok(starts[j] >= 0, part.from);
          assert.ok(j === 0 ? starts[j] === 0 : starts[j] > starts[j - 1]);
          const chunk = rows.slice(starts[j], starts[j + 1] ?? rows.length);
          partition.push(...chunk);
          const html = renderedParts[j];
          assert.ok(html.includes(`<span class="gorder-part-title">${part.title}</span>`));
          const partMain = chunk.filter(r => r.main).length, partAlso = chunk.reduce((n, r) => n + r.also.length, 0);
          assert.ok(html.includes(`<span class="gorder-count">${[partMain ? `큰 줄기 ${partMain}` : "", partAlso ? `함께 읽기 ${partAlso}` : ""].filter(Boolean).join(" · ")}</span>`));
          assert.doesNotMatch(html, /gorder-years/);
          assert.deepEqual([...html.matchAll(/class="gorder-ref"[^>]*>([^<]+)<\/button>/g)].map(m => m[1]), chunk.flatMap(r => [r.main, ...r.also].filter(Boolean)).map(fullRef));
        }
        assert.deepEqual(partition, rows);
      }
      const renderedRows = era.match(/<div class="gorder-row">[\s\S]*?(?=<div class="gorder-row">|<\/div>\s*<\/details>\s*<\/li>)/g) || [];
      assert.equal(renderedRows.length, rows.length);
      for (const [j, { main, also }] of rows.entries()) {
        const row = renderedRows[j];
        assert.deepEqual([...row.matchAll(/class="gorder-ref"[^>]*>([^<]+)<\/button>/g)].map(m => m[1]), [main, ...also].filter(Boolean).map(fullRef));
        if (main) assert.ok(row.includes(`>${fullRef(main)}</button>`));
        if (also.length) {
          assert.match(row, /<ul class="gorder-also-list">/);
          assert.match(row, /<div class="gorder-also"><span class="gorder-also-label">함께 읽기<\/span><ul class="gorder-also-list">/);
          for (const item of also) assert.ok(row.includes(`>${fullRef(item)}</button></li>`), item);
        }
      }
      if (title === "포로기") {
        assert.doesNotMatch(era, /class="gorder-main"/);
        assert.match(era, /<div class="gorder-also"><span class="gorder-also-label">함께 읽기<\/span>/);
        for (const item of rows.flatMap(({ also }) => also)) assert.ok(era.includes(`>${fullRef(item)}</button></li>`));
      }
    }
    for (const item of chronoOrder().flatMap((g) => g.items)) {
      assert.ok(app.innerHTML.includes(`<button class="gorder-ref" type="button" data-action="book-guide" data-book="${abbrBook(item)}">${fullRef(item)}</button>`), item);
    }
    assert.equal((app.innerHTML.match(/data-action="book-guide"/g) || []).length, chronoOrder().flatMap((g) => g.items).length);
    assert.equal((app.innerHTML.match(/class="gorder-ref"/g) || []).length, 361);
    assert.match(app.innerHTML, /class="gorder-main">[^<]*<button[^>]*>사무엘상 21장<\/button><\/div>\s*<div class="gorder-also"><span class="gorder-also-label">함께 읽기<\/span><ul class="gorder-also-list"><li><button[^>]*>시편 34편<\/button><\/li><li><button[^>]*>시편 56편<\/button><\/li><\/ul><\/div>/);
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


test("66권 배경 본문은 두 모드에서 구약·신약 분류 66권을 표시하고 책 배경 창을 연다", async () => {
  const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  const guide = source.slice(source.indexOf("const GORDER_COLORS ="), source.indexOf("// ── 화면: 설정"));
  const clickSource = source.slice(source.lastIndexOf('document.addEventListener("click"'), source.indexOf('document.addEventListener("change"'));
  for (const mode of ["group", "personal"]) {
    let sheet, click;
    const app = { innerHTML: "" };
    const context = {
      $: () => app, navHtml: () => "", store: { set() {} }, window: { scrollTo() {} }, render: () => runInNewContext("renderGuide()", context),
      S: { mode }, esc: (value) => String(value),
      openSheet: (html) => { sheet = html; },
      document: { addEventListener: (type, fn) => { if (type === "click") click = fn; } },
      BOOK_MORE, TAGS, DISCIPLES_INTRO, DISCIPLES, SAME_NAMES, BOOK_GROUPS, BOOK_GUIDE, ERAS, CHRONO_PARTS, abbrBook, resolveBook, chronoTimeline, fullRef,
    };
    runInNewContext(`${guide}\n${clickSource}`, context);
    const press = async (dataset) => click({ target: { closest: () => ({ dataset }) } });
    await press({ action: "guide-tab", guideTab: "books" });
    const booksHtml = app.innerHTML;
    assert.match(booksHtml, /구약 <small>39권<\/small>/);
    assert.match(booksHtml, /신약 <small>27권<\/small>/);
    for (const [, title, books] of BOOK_GROUPS) {
      assert.ok(booksHtml.includes(`<h3 class="ggroup-t">${title} <small>${books.length}권</small></h3>`));
    }
    const books = [...booksHtml.matchAll(/data-action="book-guide" data-book="([^"]+)">([^<]+)<\/button>/g)];
    assert.equal(books.length, 66);
    assert.deepEqual(books.map(m => m[1]), BOOK_GROUPS.flatMap(([, , names]) => names));
    assert.deepEqual(books.map(m => m[2]).sort(), [...CANON].sort());
    for (const [, book] of books) {
      await press({ action: "book-guide", book });
      assert.match(sheet, /<div class="book-guide">/);
      assert.ok(sheet.includes(`<h3>${book}</h3>`));
      assert.ok(!sheet.includes('<h3>66권 찾기</h3>'));
      const eras = [...new Set(BOOK_GUIDE[book].eras.map(t => t === "욥기" ? "시작과 족장" : t))];
      const timeline = ERAS.filter(e => e.title !== "욥기");
      assert.deepEqual([...sheet.matchAll(/<span class="chip">([^<]+)<\/span>/g)].map(m => m[1]),
        eras.map(t => `${String(timeline.findIndex(e => e.title === t) + 1).padStart(2, "0")} · ${t}`));
    }
    await press({ action: "book-guide", book: "욥기" });
    assert.equal((sheet.match(/01 · 시작과 족장/g) || []).length, 1);
    assert.doesNotMatch(sheet, /09 · 욥기/);
    await press({ action: "book-guide", book: "누가복음" });
    assert.match(sheet, /09 · 예수님/);
    // 자료에 두 시대 이름이 함께 들어 있어도 합쳐진 칩은 한 번만 표시한다.
    context.BOOK_GUIDE = { ...BOOK_GUIDE, 욥기: { ...BOOK_GUIDE.욥기, eras: ["욥기", "시작과 족장", "욥기"] } };
    await press({ action: "book-guide", book: "욥기" });
    assert.equal((sheet.match(/<span class="chip">01 · 시작과 족장<\/span>/g) || []).length, 1);
  }
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /\.gorder-summary\s*\{[^}]*font-size: 14\.5px;[^}]*line-height: 1\.6;/);
  assert.doesNotMatch(css, /\.(?:eras|era|era-no|era-t|era-people|egroup|guide-views)(?:[\s.{:]|$)/);
  const today = source.slice(source.indexOf("function bookInfoHtml"), source.indexOf("function checksHtml"));
  assert.match(today, /data-action="book-guide"/);
  assert.match(today, /ⓘ/);
});
