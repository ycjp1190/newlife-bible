// 성경 길잡이 자료: 66권·구간 이름이 앱의 다른 자료와 맞는지
import { test } from "node:test";
import assert from "node:assert/strict";
import { BOOK_NAMES } from "../public/shared/bible.js";
import { EOSEONG } from "../public/shared/eoseong.js";
import { BOOK_GUIDE, CANON, ERAS } from "../public/shared/guide.js";

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
