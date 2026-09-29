// 397일 기본 읽기표를 만들고 PDF에서 추출한 글과 대조 검증한다.
// 실행: deno run -A scripts/build-plan.mjs   (또는 node scripts/build-plan.mjs)
// 결과: data/plan-397.json, data/seed.sql
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { buildDefaultPlan, formatChapters, partOf, PART_TITLES } from "../public/shared/bible.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const plan = buildDefaultPlan(3);

// ── 기본 검사 ──
const totalChapters = plan.reduce((n, d) => n + d.chapters.length, 0);
const errors = [];
if (plan.length !== 397) errors.push(`일수 ${plan.length} (397이어야 함)`);
if (totalChapters !== 1189) errors.push(`장 수 ${totalChapters} (1189이어야 함)`);
if (plan[396]?.chapters.length !== 1) errors.push("마지막 날은 1장이어야 함");

// ── PDF 대조: PDF 글에서 DAY별 본문이 순서대로 모두 나오는지, PART 번호 흐름이 같은지 ──
// 원본 PDF 글(data/roadmap-extracted.txt)은 저장소에 올리지 않으므로, 파일이 있을 때만 대조한다.
const pdfPath = root + "data/roadmap-extracted.txt";
const hasPdf = existsSync(pdfPath);
const pdf = (hasPdf ? readFileSync(pdfPath, "utf8") : "")
  .replaceAll("∬", "·")
  .replace(/[ \t]+/g, " ");
const checklistStart = pdf.indexOf("DAY 1–397");
let cursor = checklistStart;
for (const d of hasPdf ? plan : []) {
  const text = formatChapters(d.chapters);
  const at = pdf.indexOf(text, cursor);
  if (at < 0) { errors.push(`DAY ${d.day} "${text}" 를 PDF 순서에서 찾지 못함`); continue; }
  cursor = at + text.length;
}
// PART 열: "NN · 제목 □" 가 DAY 순서대로 397번 나온다
const pdfParts = [...pdf.slice(checklistStart).matchAll(/(\d{2}) · ([^□\n]+?) □/g)].map((m) => Number(m[1]));
if (hasPdf && pdfParts.length !== 397) errors.push(`PDF의 PART 표기 ${pdfParts.length}개 (397이어야 함)`);
plan.forEach((d, i) => {
  if (pdfParts[i] !== undefined && pdfParts[i] !== partOf(d.chapters)) {
    errors.push(`DAY ${d.day} PART ${partOf(d.chapters)} ≠ PDF ${pdfParts[i]}`);
  }
});

if (errors.length) {
  console.error("검증 실패:\n" + errors.join("\n"));
  globalThis.Deno ? Deno.exit(1) : process.exit(1);
}

writeFileSync(root + "data/plan-397.json", JSON.stringify(plan, null, 0).replaceAll("},{", "},\n{") + "\n");

// ── D1 초기 데이터 (읽기표만. 시작일은 앱 설정에서 정함) ──
const q = (s) => "'" + String(s).replaceAll("'", "''") + "'";
const lines = ["DELETE FROM plan_days;"];
for (const d of plan) {
  lines.push(`INSERT INTO plan_days (day, chapters) VALUES (${d.day}, ${q(JSON.stringify(d.chapters))});`);
}
writeFileSync(root + "data/seed.sql", lines.join("\n") + "\n");

console.log(`OK: ${plan.length}일, ${totalChapters}장` + (hasPdf ? ", PDF와 DAY별 본문·PART 모두 일치" : " (PDF 글 파일이 없어 PDF 대조는 건너뜀)"));
console.log(`DAY 1 = ${formatChapters(plan[0].chapters)} (PART ${partOf(plan[0].chapters)} ${PART_TITLES[1]})`);
console.log(`DAY 397 = ${formatChapters(plan[396].chapters)}`);
