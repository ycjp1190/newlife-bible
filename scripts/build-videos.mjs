// data/chapter-videos.json → public/shared/videos.js (장별 본문 영상 ID)
// 실행: node scripts/build-videos.mjs   (영상 다시 모으기: python3 scripts/collect-videos.py data/chapter-videos.json)
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../public/shared/bible.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const { videos } = JSON.parse(readFileSync(root + "data/chapter-videos.json", "utf8"));
const missing = [];
const byBook = {};
for (const [book, { chapters }] of Object.entries(BOOKS)) {
  byBook[book] = Array.from({ length: chapters }, (_, i) => {
    const v = videos[`${book} ${i + 1}`];
    if (!v) missing.push(`${book} ${i + 1}`);
    return v || "";
  });
}
if (missing.length) throw new Error(`영상이 없는 장: ${missing.join(", ")}`);
writeFileSync(root + "public/shared/videos.js",
  "// 자동 생성 파일 — 직접 고치지 말고 data/chapter-videos.json 을 고친 뒤 node scripts/build-videos.mjs\n" +
  "// 공동체성경읽기 채널(@PRS) '장별 구절 영상(개역개정)' — 책마다 [1장, 2장, ...] 의 유튜브 영상 ID\n" +
  `export const CHAPTER_VIDEOS = ${JSON.stringify(byBook)};\n\n` +
  "// [책, 장] 의 영상 주소 (없으면 null)\n" +
  "export const chapterVideo = ([book, ch]) => {\n" +
  "  const id = CHAPTER_VIDEOS[book]?.[ch - 1];\n" +
  "  return id ? `https://www.youtube.com/watch?v=${id}` : null;\n" +
  "};\n");
console.log("ok", Object.keys(byBook).length);
