// 오늘 본문에서 길잡이의 시간 순서 위치 찾기. 원본 자료는 수정하지 않는다.
import { BOOKS, resolveBook } from "./bible.js";
import { abbrBook } from "./eoseong120.js";
import { CHRONO_PARTS } from "./guide.js";

// 절·반절은 버리고 장으로 비교한다. 절 뒤의 ~23a는 같은 장,
// ~8장 또는 ~5:20은 끝 장이다. 표시 문자열과 원본 순서는 바꾸지 않는다.
export function guideChapterRange(item) {
  const text = String(item ?? "").replace(/[()]/g, "").trim();
  const match = text.match(/^(\S+)\s+(\d+)(?:[장편])?(?::\d+[ab]?)?(?:\s*[~–-]\s*(\d+)[ab]?([장편])?(?::(\d+)[ab]?)?)?$/);
  if (!match) return null;
  const book = abbrBook(text) || resolveBook(match[1]);
  if (!book) return null;
  const start = Number(match[2]);
  const verseRange = text.includes(":") && !match[4] && !match[5];
  const end = match[3] && !verseRange ? Number(match[3]) : start;
  if (start < 1 || end < start || end > BOOKS[book].chapters) return null;
  return { book, start, end };
}

// 렌더링에 쓰는 시대/행 배열을 그대로 받아 DOM 없이 이동 대상을 계산한다.
// refIndexes는 큰 줄기(있을 때) 다음 함께 읽기 순서의 버튼 번호다.
export function guideMatches(chapters, eras, parts = CHRONO_PARTS) {
  const today = new Map();
  for (const [book, chapter] of chapters) {
    if (!today.has(book)) today.set(book, new Set());
    today.get(book).add(chapter);
  }
  return eras.flatMap(({ title, rows }, eraIndex) => {
    const starts = parts[title]?.map(({ from }) => rows.findIndex(({ main }) => main === from));
    const partIndexes = new Set();
    const matches = rows.flatMap(({ main, also }, rowIndex) => {
      const refIndexes = [main, ...also].filter(Boolean).flatMap((ref, refIndex) => {
        const range = guideChapterRange(ref);
        return range && [...(today.get(range.book) || [])].some(ch => range.start <= ch && ch <= range.end) ? [refIndex] : [];
      });
      if (!refIndexes.length) return [];
      if (starts) partIndexes.add(starts.findLastIndex(start => start <= rowIndex));
      return [{ rowIndex, refIndexes }];
    });
    return matches.length ? [{ eraIndex, partIndexes: [...partIndexes], rows: matches }] : [];
  });
}

