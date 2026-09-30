// 맥체인 성경읽기 달력 PDF 글(data/mcheyne-extracted.txt)을 해석해 public/shared/mcheyne.js 를 만들고 검증한다.
// 실행: node scripts/build-mcheyne.mjs
//
// PDF 글은 여러 달이 줄마다 섞여 있다. 그래서 "각 칸(4칸)의 본문은 전날 본문 바로 다음부터 이어진다"는
// 맥체인 읽기표의 성질(연속성)로 줄마다 어느 달인지 판별하고, 같은 성질로 결과 전체를 검증한다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOOKS, resolveBook } from "../public/shared/bible.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const SRC = root + "data/mcheyne-extracted.txt";
const OUT = root + "public/shared/mcheyne.js";
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PSALMS = "시편";
const NT = new Set(["마태복음", "마가복음", "누가복음", "요한복음", "사도행전", "로마서", "고린도전서", "고린도후서", "갈라디아서",
  "에베소서", "빌립보서", "골로새서", "데살로니가전서", "데살로니가후서", "디모데전서", "디모데후서", "디도서", "빌레몬서",
  "히브리서", "야고보서", "베드로전서", "베드로후서", "요한일서", "요한이서", "요한삼서", "유다서", "요한계시록"]);

if (!existsSync(SRC)) {
  console.log("data/mcheyne-extracted.txt 가 없어 맥체인 데이터 재생성을 건너뜀 (저장된 public/shared/mcheyne.js 사용)");
  process.exit(0);
}

// "출 11 : 1~12 : 28" → { book, sc, sv, ec, ev }
function parseReading(raw) {
  const s = raw.replace(/\s+/g, "");
  const m = s.match(/^([가-힣]+)(\d+)(?::(\d+))?(?:~(\d+)(?::(\d+))?)?$/);
  if (!m) throw new Error(`본문을 해석하지 못함: "${raw}"`);
  const book = resolveBook(m[1]);
  if (!book) throw new Error(`책 이름을 모름: "${m[1]}"`);
  const sc = Number(m[2]);
  const sv = m[3] ? Number(m[3]) : null;
  let ec = sc;
  let ev = null;
  if (m[4]) {
    if (m[5]) { ec = Number(m[4]); ev = Number(m[5]); } // 장:절~장:절
    else if (sv !== null) { ev = Number(m[4]); } // 장:절~절
    else { ec = Number(m[4]); } // 장~장
  }
  if (sc < 1 || ec < sc || ec > BOOKS[book].chapters) throw new Error(`장 범위 오류: "${raw}"`);
  return { book, sc, sv, ec, ev };
}

// 칸 연속성: next 가 prev 바로 다음부터 시작하는가
function continues(prev, next) {
  if (prev.book === next.book) {
    if (next.sv !== null && next.sv > 1) return next.sc === prev.ec && prev.ev !== null && next.sv === prev.ev + 1;
    return next.sc === prev.ec + 1;
  }
  const prevEnded = prev.ec === BOOKS[prev.book].chapters;
  return prevEnded && next.sc === 1 && (next.sv === null || next.sv === 1);
}

// ── 줄 읽기 ──
const lines = readFileSync(SRC, "utf8").split("\n").map((l) => l.trim());
const cal = MONTHS.map(() => []); // cal[month][day-1] = [4 readings]
let section = [];
let lastWasHeader = false;
for (const line of lines) {
  const header = line.match(/^(January|February|March|April|May|June|July|August|September|October|November|December) \d{2}$/);
  if (header) {
    if (!lastWasHeader) section = [];
    section.push(MONTHS.indexOf(header[1]));
    lastWasHeader = true;
    continue;
  }
  const row = line.replace(/[()]/g, "").match(/^(\d+) (.+┃.+)$/);
  lastWasHeader = false;
  if (!row) continue;
  const day = Number(row[1]);
  const parts = row[2].split("┃").map((p) => p.trim());
  if (parts.length !== 4) throw new Error(`4곳이 아님: "${line}"`);
  const readings = parts.map(parseReading);

  const candidates = section.filter((m) => cal[m].length === day - 1 && day <= MONTH_DAYS[m]);
  if (!candidates.length) throw new Error(`어느 달인지 모름: "${line}" (구역 ${section.map((m) => MONTHS[m]).join(",")})`);
  let chosen = candidates[0];
  if (candidates.length > 1 && day > 1) {
    const score = (m) => cal[m][day - 2].filter((p, i) => continues(p, readings[i])).length;
    chosen = candidates.reduce((best, m) => (score(m) > score(best) ? m : best), candidates[0]);
  }
  cal[chosen].push(readings);
}

// ── 검증 ──
const errors = [];
MONTH_DAYS.forEach((n, m) => {
  if (cal[m].length !== n) errors.push(`${MONTHS[m]}: ${cal[m].length}일 (${n}일이어야 함)`);
});
// 2월 29일은 윤년에만 읽는 추가 분량이므로 연속성 검사에서는 뺀다
const year = [];
cal.forEach((days, m) => days.forEach((r, i) => { if (!(m === 1 && i === 28)) year.push({ key: `${m + 1}/${i + 1}`, r }); }));
if (year.length !== 365) errors.push(`평년 일수 ${year.length}`);
for (let col = 0; col < 4; col++) {
  for (let i = 1; i < year.length; i++) {
    const prev = year[i - 1].r[col];
    const next = year[i].r[col];
    if (!continues(prev, next)) errors.push(`${col + 1}번째 칸 ${year[i - 1].key}→${year[i].key} 이어지지 않음: ${prev.book} ${prev.ec} → ${next.book} ${next.sc}`);
  }
}
// 1년 동안 각 장이 몇 번 읽히는가 (부분 읽기로 한 장이 둘로 나뉘면 한 번으로 친다)
const passes = new Map();
for (let col = 0; col < 4; col++) {
  const seen = new Set();
  for (const { r } of year) {
    const x = r[col];
    for (let c = x.sc; c <= x.ec; c++) {
      seen.add(`${x.book} ${c}#${col}`);
    }
  }
  for (const k of seen) {
    const key = k.split("#")[0];
    passes.set(key, (passes.get(key) || 0) + 1);
  }
}
for (const [book, { chapters }] of Object.entries(BOOKS)) {
  const want = NT.has(book) || book === PSALMS ? 2 : 1;
  for (let c = 1; c <= chapters; c++) {
    const got = passes.get(`${book} ${c}`) || 0;
    if (got !== want) errors.push(`${book} ${c}장: 1년에 ${got}번 (${want}번이어야 함)`);
  }
}

if (errors.length) {
  console.error(`검증 실패 (${errors.length}건):\n` + errors.slice(0, 40).join("\n"));
  process.exit(1);
}

// ── 저장 ──
const label = ({ sc, sv, ec, ev }) => {
  if (sv === null && ev === null) return sc === ec ? `${sc}장` : `${sc}–${ec}장`;
  return `${sc}:${sv ?? 1}–${ec === sc ? ev : `${ec}:${ev}`}`;
};
const out = {};
cal.forEach((days, m) => days.forEach((r, i) => {
  out[`${String(m + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`] = r.map((x) => [x.book, x.sc, label(x)]);
}));
const body = Object.entries(out).map(([k, v]) => `  "${k}": ${JSON.stringify(v)},`).join("\n");
writeFileSync(OUT, `// 맥체인 성경읽기표 (날짜 → 4곳). scripts/build-mcheyne.mjs 로 생성 — 직접 고치지 않는다.
// 항목: [책, 시작 장, 표시 이름]. 1년에 시편을 뺀 구약은 1번, 신약과 시편은 2번 읽는다. "02-29" 는 윤년에만.
export const MCHEYNE = {
${body}
};
`);
console.log(`OK: 365일 + 2월 29일, 매일 4곳, 4칸 모두 1년 내내 끊김 없이 이어짐, 구약 1번·신약과 시편 2번`);
console.log(`1월 1일 = ${out["01-01"].map((x) => `${x[0]} ${x[2]}`).join(" | ")}`);
console.log(`9월 30일 = ${out["09-30"].map((x) => `${x[0]} ${x[2]}`).join(" | ")}`);
