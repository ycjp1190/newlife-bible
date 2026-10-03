// data/eoseong-order.txt (「어? 성경이 읽어지네!」 읽는 순서) → public/shared/eoseong.js
// 실행: node scripts/build-eoseong.mjs
// - 절 단위 범위를 장 단위로 바꾼다. 한 장이 여러 곳에 나뉘어 있으면 그 장의 1절부터 읽는 자리에 장 전체를 둔다.
//   (예: 갈 2:11-14 가 먼저 나와도 갈라디아서 2장은 '갈1-6' 자리에서 읽는다. 1절부터 읽는 자리가 없으면 처음 나오는 자리)
// - 1,189장이 빠짐없이 한 번씩 들어갔는지 확인한다.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BOOKS } from "../public/shared/bible.js";

const root = fileURLToPath(new URL("..", import.meta.url));

const ABBR = {
  창: "창세기", 출: "출애굽기", 레: "레위기", 민: "민수기", 신: "신명기", 수: "여호수아", 삿: "사사기", 룻: "룻기",
  삼상: "사무엘상", 삼하: "사무엘하", 왕상: "열왕기상", 왕하: "열왕기하", 대상: "역대상", 대하: "역대하",
  라: "에스라", 느: "느헤미야", 더: "에스더", 욥: "욥기", 시: "시편", 잠: "잠언", 전: "전도서", 아: "아가",
  사: "이사야", 렘: "예레미야", 애: "예레미야애가", 겔: "에스겔", 단: "다니엘", 호: "호세아", 욜: "요엘", 암: "아모스",
  옵: "오바댜", 욘: "요나", 미: "미가", 나: "나훔", 합: "하박국", 습: "스바냐", 학: "학개", 슥: "스가랴", 말: "말라기",
  마: "마태복음", 막: "마가복음", 눅: "누가복음", 요: "요한복음", 행: "사도행전", 롬: "로마서", 고전: "고린도전서",
  고후: "고린도후서", 갈: "갈라디아서", 엡: "에베소서", 빌: "빌립보서", 골: "골로새서", 살전: "데살로니가전서",
  살후: "데살로니가후서", 딤전: "디모데전서", 딤후: "디모데후서", 딛: "디도서", 몬: "빌레몬서", 히: "히브리서",
  약: "야고보서", 벧전: "베드로전서", 벧후: "베드로후서", 요일: "요한일서", 요이: "요한이서", 요삼: "요한삼서",
  유: "유다서", 계: "요한계시록",
};
const abbrRe = new RegExp(`^(${Object.keys(ABBR).sort((a, b) => b.length - a.length).join("|")})(.+)$`);

// "출1:1-4:17" → [출애굽기, 1, 4], "요7:11-8장" → [요한복음, 7, 8], "민9:1-14" → [민수기, 9, 9], "창1-11" → [창세기, 1, 11]
export function parseRef(ref) {
  const m = ref.trim().match(abbrRe);
  if (!m) throw new Error(`책 이름을 모르겠어요: ${ref}`);
  const book = ABBR[m[1]];
  const rest = m[2].replace(/[장편]$/, "");
  const [a, b] = rest.split("-");
  const from = parseInt(a, 10);
  let to = from;
  if (b !== undefined) {
    if (!a.includes(":")) to = parseInt(b, 10); // 장 범위
    else if (b.includes(":") || /[장편]$/.test(m[2])) to = parseInt(b, 10); // 다른 장의 절까지 / "…-8장"
  }
  if (!(from >= 1 && to >= from && to <= BOOKS[book].chapters)) throw new Error(`범위가 이상해요: ${ref}`);
  const startsMid = a.includes(":") && !/^\d+:1$/.test(a); // 장 중간 절부터 시작
  return [book, from, to, startsMid];
}

export function buildEoseong(text) {
  // 1) 범위를 차례로 훑으며 장마다 '1절부터 읽는 첫 자리'와 '처음 나오는 자리'를 기록
  const titles = [];
  const first = new Map(); // key → { pos, sec, book, c }
  const claim = new Map();
  let pos = 0;
  for (const line of text.split("\n")) {
    const sec = line.match(/^# 구간:\s*(.+)$/);
    if (sec) { titles.push(sec[1].trim()); continue; }
    const day = line.match(/^(\d+):\s*(.+)$/);
    if (!day) continue;
    for (const ref of day[2].split(",")) {
      const [book, from, to, startsMid] = parseRef(ref);
      for (let c = from; c <= to; c++, pos++) {
        const key = `${book} ${c}`;
        const at = { pos, sec: titles.length - 1, book, c };
        if (!first.has(key)) first.set(key, at);
        if (!claim.has(key) && !(c === from && startsMid)) claim.set(key, at);
      }
    }
  }
  const seen = new Set(first.keys());
  // 2) 장을 자리 순서로 늘어놓고 구간별로 이어지는 장을 묶는다
  const sections = titles.map((t) => [t, []]);
  const at = new Map([...first.keys()].map((k) => [k, claim.get(k) || first.get(k)]));
  // 다음 장이 더 먼저 오게 되면(예: 행 9:32-11:18 → 9:1-31) 처음 나오는 자리로 당겨 장 순서를 지킨다
  for (const [k, v] of at) {
    const next = at.get(`${v.book} ${v.c + 1}`);
    if (next && next.pos < v.pos && first.get(k).pos < next.pos) at.set(k, first.get(k));
  }
  const placed = [...at.values()].sort((x, y) => x.pos - y.pos);
  for (const { sec, book, c } of placed) {
    const units = sections[sec][1];
    const last = units.at(-1);
    if (last && last[0] === book && last[2] === c - 1) last[2] = c; else units.push([book, c, c]);
  }
  const missing = Object.entries(BOOKS).flatMap(([b, { chapters }]) =>
    Array.from({ length: chapters }, (_, i) => `${b} ${i + 1}`).filter((k) => !seen.has(k)));
  if (missing.length) throw new Error(`빠진 장: ${missing.join(", ")}`);
  // 책 전체를 한 번에 읽는 단위는 책 이름만
  return sections.map(([t, units]) => [t, units.map(([b, f, e]) => (f === 1 && e === BOOKS[b].chapters ? b : [b, f, e]))]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sections = buildEoseong(readFileSync(root + "data/eoseong-order.txt", "utf8"));
  const body = sections.map(([t, u]) => `  [${JSON.stringify(t)}, ${JSON.stringify(u)}],`).join("\n");
  writeFileSync(root + "public/shared/eoseong.js",
    `// 자동 생성 파일 — 직접 고치지 말고 data/eoseong-order.txt 를 고친 뒤 node scripts/build-eoseong.mjs\n` +
    `// 「어? 성경이 읽어지네!」 읽는 순서 (장 단위). [구간 제목, [읽기 단위...]]\n` +
    `export const EOSEONG = [\n${body}\n];\n`);
  console.log(sections.map(([t, u]) => `${t}: ${u.length}`).join("\n"));
}
