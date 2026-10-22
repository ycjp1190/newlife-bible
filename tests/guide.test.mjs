// 성경 길잡이 자료: 66권·구간 이름이 앱의 다른 자료와 맞는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { BOOK_NAMES } from "../public/shared/bible.js";
import { EOSEONG } from "../public/shared/eoseong.js";
import { BOOK_GUIDE, CANON, ERAS } from "../public/shared/guide.js";
import { abbrBook, BOOK_ABBR, EOSEONG120 } from "../public/shared/eoseong120.js";

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
