// 333 공동체성경읽기(365일 읽기 플랜) 데이터를 만들고 검증한다.
// 원본: data/community-365.txt (유튜브 재생목록 영상 제목 그대로) → 결과: public/shared/community.js
// 실행: node scripts/build-community.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOOKS, resolveBook } from "../public/shared/bible.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const PLAYLIST = "PLVcVykBcFZTR4Q6cvmybjPgCklZlv-Ghj";

// 영상 제목 오류 보정 (앞뒤 날의 흐름으로 확인)
const FIXES = {
  82: ["(수-, 시82)", "(수23-24, 시82)"], // 제목에 장 번호 빠짐. 81일차 수20-22 다음
  246: ["", "(겔25-27, 시91)"], // 재생목록에 영상 없음. 245일차 겔23-24·시90, 247일차 겔28-30·시92 사이
  279: ["(마 8-10, 시 116:153-176)", "(마 8-10, 시 119:153-176)"], // 시116 → 시119 (278일차 시119:129-152 다음)
  349: ["(딛 1-3, 빌 1, 시 39)", "(딛 1-3, 몬 1, 시 39)"], // 빌립보서는 343일차에 읽음 → 빌레몬서
};

const CANON = ["창세기", "출애굽기", "레위기", "민수기", "신명기", "여호수아", "사사기", "룻기", "사무엘상", "사무엘하",
  "열왕기상", "열왕기하", "역대상", "역대하", "에스라", "느헤미야", "에스더", "욥기", "시편", "잠언", "전도서", "아가",
  "이사야", "예레미야", "예레미야애가", "에스겔", "다니엘", "호세아", "요엘", "아모스", "오바댜", "요나", "미가", "나훔",
  "하박국", "스바냐", "학개", "스가랴", "말라기", "마태복음", "마가복음", "누가복음", "요한복음", "사도행전", "로마서",
  "고린도전서", "고린도후서", "갈라디아서", "에베소서", "빌립보서", "골로새서", "데살로니가전서", "데살로니가후서",
  "디모데전서", "디모데후서", "디도서", "빌레몬서", "히브리서", "야고보서", "베드로전서", "베드로후서", "요한일서",
  "요한이서", "요한삼서", "유다서", "요한계시록"];

const errors = [];
const days = [];
for (const line of readFileSync(root + "data/community-365.txt", "utf8").split("\n")) {
  if (!line.trim() || line.startsWith("#")) continue;
  const [dayStr, rawTitle = "", video = ""] = line.split("\t");
  const day = Number(dayStr);
  let title = rawTitle;
  if (FIXES[day]) {
    if (FIXES[day][0] !== rawTitle) errors.push(`${day}일차 보정 대상 제목이 바뀜: "${rawTitle}"`);
    title = FIXES[day][1];
  }
  const items = [];
  for (const part of title.replace(/[()]/g, "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = part.replace(/\s+/g, "").match(/^([가-힣]+?)(\d+)(?::(\d+)-(\d+)|-(\d+))?$/);
    const book = m && resolveBook(m[1]);
    if (!book) { errors.push(`${day}일차 "${part}" 해석 실패`); continue; }
    const from = Number(m[2]);
    if (m[3]) { items.push([book, from, `${from}:${m[3]}–${m[4]}`]); continue; } // 시119:1-32 처럼 절 단위
    const to = m[5] ? Number(m[5]) : from;
    if (to < from || to > BOOKS[book].chapters) errors.push(`${day}일차 "${part}" 장 범위 오류`);
    for (let c = from; c <= to; c++) items.push([book, c]);
  }
  days.push({ day, items, video });
}

// ── 검증 ──
if (days.length !== 365 || days.some((d, i) => d.day !== i + 1)) errors.push(`일수 ${days.length} (1–365 연속이어야 함)`);
// 1) 시편을 뺀 본문: 창세기 1장부터 요한계시록 22장까지 정경 순서대로 빠짐없이 한 번씩
const expected = CANON.filter((b) => b !== "시편").flatMap((b) => Array.from({ length: BOOKS[b].chapters }, (_, i) => `${b} ${i + 1}`));
const main = days.flatMap((d) => d.items.filter(([b]) => b !== "시편").map(([b, c]) => `${b} ${c}`));
if (main.length !== expected.length) errors.push(`본문 장 수 ${main.length} (${expected.length}이어야 함)`);
const firstDiff = expected.findIndex((k, i) => main[i] !== k);
if (firstDiff >= 0) errors.push(`본문 순서가 ${firstDiff + 1}번째에서 어긋남: ${main[firstDiff]} (기대: ${expected[firstDiff]})`);
// 2) 시편: 매일 한 곳, 1편→150편 차례로 돌고 다시 1편. 119편은 절 단위로 나눠 이어짐
let prev = null;
for (const d of days) {
  const ps = d.items.filter(([b]) => b === "시편");
  if (ps.length !== 1) { errors.push(`${d.day}일차 시편 ${ps.length}곳`); continue; }
  const [, c, label] = ps[0];
  if (prev) {
    const [, pc, plabel] = prev;
    const pEnd = plabel ? Number(plabel.split("–")[1]) : null;
    const ok = label && plabel && c === pc
      ? Number(label.split(":")[1].split("–")[0]) === pEnd + 1
      : label && Number(label.split(":")[1].split("–")[0]) !== 1 ? false
        : (plabel && pEnd !== 176) ? false
          : c === (pc % 150) + 1;
    if (!ok) errors.push(`${d.day}일차 시편이 이어지지 않음: ${plabel || pc} → ${label || c}`);
  }
  prev = ps[0];
}
const videos = days.filter((d) => d.video).length;
if (videos !== 364) errors.push(`영상 ${videos}개 (246일차 빼고 364개여야 함)`);

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건):\n` + errors.slice(0, 30).join("\n"));
  process.exit(1);
}

const body = days.map((d) => `  { chapters: ${JSON.stringify(d.items)}, video: ${JSON.stringify(d.video)} },`).join("\n");
writeFileSync(root + "public/shared/community.js", `// 333 공동체성경읽기 365일 읽기 플랜. scripts/build-community.mjs 로 생성 — 직접 고치지 않는다.
// COMMUNITY[n-1] = n일차 (1월 1일 = 1일차). video = 그날 유튜브 영상 ID (없으면 "")
export const COMMUNITY_PLAYLIST = "${PLAYLIST}";
export const COMMUNITY = [
${body}
];
`);
console.log("OK: 365일, 시편 뺀 본문 1,039장이 창세기 1장~요한계시록 22장 순서대로 한 번씩, 시편 매일 1곳 이어짐, 영상 364개");
console.log(`1일차 = ${days[0].items.map((x) => x.join(" ")).join(" | ")}`);
