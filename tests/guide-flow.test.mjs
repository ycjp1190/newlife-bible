import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { guideChapterRange, guideMatches } from "../public/shared/guide-flow.js";
import { chronoTimeline, EOSEONG120 } from "../public/shared/eoseong120.js";
import { CHRONO_PARTS } from "../public/shared/guide.js";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
// 화면이 쓰는 욥기 병합까지 포함한 실제 시대/행 배열로 검사한다.
const eras = JSON.parse(JSON.stringify(runInNewContext(source.slice(source.indexOf("function orderEras()"), source.indexOf("function renderGuide()")) + "orderEras()", { chronoTimeline })));

const cases = [
  ["눅 3:21~23a", "누가복음", 3, 3],
  ["요 7:11~8장", "요한복음", 7, 8],
  ["마 5~7장", "마태복음", 5, 7],
  ["행 9:32~11:18", "사도행전", 9, 11],
  ["(시 34편)", "시편", 34, 34],
  ["막 4:35~5:20", "마가복음", 4, 5],
  ["창 1~50장", "창세기", 1, 50],
  [" (눅 3:23b~38) ", "누가복음", 3, 3],
  ["눅 1:39~2:7", "누가복음", 1, 2],
  ["행 18:24~19:1a", "사도행전", 18, 19],
  ["요 7:1~10", "요한복음", 7, 7],
  ["(창 4-6장)", "창세기", 4, 6],
  ["누가복음 4–6장", "누가복음", 4, 6],
  ["라 7~10장", "에스라", 7, 10],
  ["(더 1~10장)", "에스더", 1, 10],
];
for (const [ref, book, start, end] of cases) test(`시대 흐름 본문 해석: ${ref}`, () => {
  assert.deepEqual(guideChapterRange(ref), { book, start, end });
});

test("시대 흐름 해석은 잘못된 본문을 거부하고 원본 462개·병합 본문 전부를 읽는다", () => {
  for (const ref of [null, "", "모름 3장", "눅 0장", "눅 25장", "눅 6~4장", "눅 3:21~", "눅 세 장"]) assert.equal(guideChapterRange(ref), null, ref);
  for (const ref of [...EOSEONG120.flatMap(d => d.items), ...eras.flatMap(e => e.rows.flatMap(r => [r.main, ...r.also].filter(Boolean)))]) assert.ok(guideChapterRange(ref), ref);
});

test("누가복음 4~6장 → 09 예수님·세례와 시험/갈릴리 사역 두 하위 구간", () => {
  const matches = guideMatches([4, 5, 6].map(ch => ["누가복음", ch]), eras);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].eraIndex, 8);
  assert.equal(eras[8].title, "예수님");
  assert.deepEqual(matches[0].partIndexes.map(i => CHRONO_PARTS.예수님[i].title), ["공생애 준비: 세례와 시험", "갈릴리 사역: 가르침과 치유"]);
  assert.equal(new Set(matches[0].partIndexes).size, 2);
});

test("창세기 4~6장 → 01 시작과 족장·하위 구간 없이 창세기 행의 큰 줄기 강조", () => {
  assert.deepEqual(guideMatches([4, 5, 6].map(ch => ["창세기", ch]), eras), [{ eraIndex: 0, partIndexes: [], rows: [{ rowIndex: 0, refIndexes: [0] }] }]);
});

test("함께 읽기·욥기 합치기·여러 책과 시대·불일치도 장으로 판정한다", () => {
  const psalm = guideMatches([["시편", 34]], eras);
  const { eraIndex, rows } = psalm[0];
  assert.equal(eras[eraIndex].title, "통일왕국");
  assert.deepEqual(psalm[0].partIndexes, []);
  assert.equal(eras[eraIndex].rows[rows[0].rowIndex].also[rows[0].refIndexes[0] - 1], "(시 34편)");
  assert.equal(guideMatches([["욥기", 3]], eras)[0].eraIndex, 0);
  const multiple = guideMatches([["창세기", 4], ["누가복음", 6, "6:1–11"], ["사도행전", 10]], eras);
  assert.deepEqual(multiple.map(m => m.eraIndex), [0, 8, 9]);
  assert.ok(multiple[2].partIndexes.length);
  assert.deepEqual(guideMatches([], eras), []);
  assert.deepEqual(guideMatches([["없는 책", 1]], eras), []);
});

test("폴더 글자 18px·600과 56px 높이·일정 고정 위치 및 움직임 줄이기 CSS", () => {
  const css = readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /\.daily-folders\s*\{[^}]*height: 56px/);
  assert.match(css, /\.daily-folders button\s*\{[^}]*min-height: 56px;[^}]*padding: 12px 20px;[^}]*font-size: 18px; font-weight: 600; white-space: nowrap;/);
  assert.match(css, /\.plan-head\s*\{[^}]*top: calc\(env\(safe-area-inset-top\) \+ 56px\)/);
  assert.match(css, /\.gorder-highlight\s*\{ animation: gorder-flash \.5s ease-in-out 6;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.gorder-highlight, \.gorder-ref.gorder-highlight\s*\{ animation: none;[^}]*var\(--gold\)/);
  const sw = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('"/shared/guide-flow.js"'));
});
