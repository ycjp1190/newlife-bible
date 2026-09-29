// 성경 책 정보와 읽기 범위 표기(포맷/해석) 공용 모듈.
// 브라우저(앱 화면)와 서버(Worker) 양쪽에서 같이 사용한다.

// 397일 로드맵의 PART 순서대로 [PART 번호, PART 제목, [[책, 장 수], ...]]
export const PARTS = [
  [1, "예수님에게서 시작하다", [["누가복음", 24], ["사도행전", 28]]],
  [2, "복음을 이해하다", [["로마서", 16], ["갈라디아서", 6]]],
  [3, "복음으로 살아가다", [["에베소서", 6], ["빌립보서", 4], ["골로새서", 4], ["빌레몬서", 1], ["야고보서", 5], ["베드로전서", 5], ["베드로후서", 3]]],
  [4, "예수님을 더 깊이 보다", [["요한복음", 21], ["요한일서", 5], ["요한이서", 1], ["요한삼서", 1]]],
  [5, "처음으로 돌아가다", [["창세기", 50], ["출애굽기", 40]]],
  [6, "거룩하신 하나님과 함께 살다", [["레위기", 27], ["민수기", 36], ["신명기", 34]]],
  [7, "약속의 땅과 왕을 기다리다", [["여호수아", 24], ["사사기", 21], ["룻기", 4], ["사무엘상", 31], ["사무엘하", 24]]],
  [8, "왕국의 몰락과 선지자의 외침", [["열왕기상", 22], ["요나", 4], ["아모스", 9], ["호세아", 14], ["열왕기하", 25], ["미가", 7], ["이사야", 66]]],
  [9, "무너진 나라와 포로", [["예레미야", 52], ["예레미야애가", 5], ["에스겔", 48], ["다니엘", 12]]],
  [10, "돌아오다", [["에스라", 10], ["학개", 2], ["스가랴", 14], ["에스더", 10], ["느헤미야", 13], ["역대상", 29], ["역대하", 36], ["말라기", 4]]],
  [11, "구약을 지나 다시 예수님", [["마태복음", 28], ["히브리서", 13]]],
  [12, "하나님 앞에서 인간으로 살다", [["욥기", 42], ["시편", 150], ["잠언", 31], ["전도서", 12], ["아가", 8]]],
  [13, "여호와의 날을 기다리다", [["요엘", 3], ["오바댜", 1], ["나훔", 3], ["하박국", 3], ["스바냐", 3]]],
  [14, "다시 복음의 중심으로", [["마가복음", 16]]],
  [15, "실제 교회와 복음의 삶", [["고린도전서", 16], ["고린도후서", 13], ["데살로니가전서", 5], ["데살로니가후서", 3], ["디모데전서", 6], ["디모데후서", 4], ["디도서", 3]]],
  [16, "새 창조를 바라보다", [["유다서", 1], ["요한계시록", 22]]],
];

export const PART_TITLES = Object.fromEntries(PARTS.map(([n, t]) => [n, t]));

// 책 이름 → { chapters, part }
export const BOOKS = {};
for (const [part, , books] of PARTS) {
  for (const [name, chapters] of books) BOOKS[name] = { chapters, part };
}
export const BOOK_NAMES = Object.keys(BOOKS);

// 흔히 쓰는 약칭도 입력으로 받아준다.
const ALIASES = {
  마태: "마태복음", 마: "마태복음", 마가: "마가복음", 막: "마가복음", 누가: "누가복음", 눅: "누가복음",
  요한: "요한복음", 요: "요한복음", 행: "사도행전", 롬: "로마서", 고전: "고린도전서", 고후: "고린도후서",
  갈: "갈라디아서", 엡: "에베소서", 빌: "빌립보서", 골: "골로새서", 살전: "데살로니가전서",
  살후: "데살로니가후서", 딤전: "디모데전서", 딤후: "디모데후서", 딛: "디도서", 몬: "빌레몬서",
  히: "히브리서", 약: "야고보서", 벧전: "베드로전서", 벧후: "베드로후서", 요일: "요한일서",
  요이: "요한이서", 요삼: "요한삼서", 유: "유다서", 계: "요한계시록",
  창: "창세기", 출: "출애굽기", 레: "레위기", 민: "민수기", 신: "신명기", 수: "여호수아", 삿: "사사기",
  룻: "룻기", 삼상: "사무엘상", 삼하: "사무엘하", 왕상: "열왕기상", 왕하: "열왕기하", 대상: "역대상",
  대하: "역대하", 스: "에스라", 느: "느헤미야", 에: "에스더", 욥: "욥기", 시: "시편", 잠: "잠언",
  전: "전도서", 아: "아가", 사: "이사야", 렘: "예레미야", 애: "예레미야애가", 겔: "에스겔",
  단: "다니엘", 호: "호세아", 욜: "요엘", 암: "아모스", 옵: "오바댜", 욘: "요나", 미: "미가",
  나: "나훔", 합: "하박국", 습: "스바냐", 학: "학개", 슥: "스가랴", 말: "말라기",
};

export function resolveBook(name) {
  const n = String(name || "").trim();
  if (BOOKS[n]) return n;
  if (ALIASES[n]) return ALIASES[n];
  return null;
}

// 장 하나의 고유 키. 체크 기록에 사용한다. 예: "로마서 1"
export const chapterKey = ([book, ch]) => `${book} ${ch}`;

// 하루 분량의 PART = 그날 첫 장의 PART (로드맵 PDF와 같은 규칙)
export function partOf(chapters) {
  if (!chapters || !chapters.length) return null;
  return BOOKS[chapters[0][0]]?.part ?? null;
}

// [["사도행전",28],["로마서",1],["로마서",2]] → "사도행전 28장 · 로마서 1–2장"
export function formatChapters(chapters) {
  if (!chapters || !chapters.length) return "쉬는 날";
  const groups = [];
  for (const [book, ch] of chapters) {
    const last = groups[groups.length - 1];
    if (last && last.book === book && last.to === ch - 1) last.to = ch;
    else groups.push({ book, from: ch, to: ch });
  }
  return groups
    .map((g) => (g.from === g.to ? `${g.book} ${g.from}장` : `${g.book} ${g.from}–${g.to}장`))
    .join(" · ");
}

// "사도행전 28장 · 로마서 1-2장" 같은 글을 장 목록으로 해석한다.
// 구분자: · , / ; ∬ 줄바꿈.  범위: - – ~ 모두 허용.  "쉬는 날" 또는 빈 글은 빈 목록.
// 해석 실패 시 { error } 를 돌려준다.
export function parseChapters(text) {
  const src = String(text || "").trim();
  if (!src || src === "쉬는 날" || src === "쉼") return { chapters: [] };
  const parts = src.split(/[·,/;∬\n]+/).map((s) => s.trim()).filter(Boolean);
  const chapters = [];
  for (const part of parts) {
    const m = part.match(/^(.+?)\s*(\d+)\s*(?:장)?\s*(?:[-–~]\s*(\d+)\s*(?:장)?)?$/);
    if (!m) return { error: `"${part}"를 이해하지 못했어요. 예: 로마서 1–3장` };
    const book = resolveBook(m[1]);
    if (!book) return { error: `"${m[1].trim()}"은(는) 성경 책 이름이 아니에요.` };
    const from = Number(m[2]);
    const to = m[3] ? Number(m[3]) : from;
    const max = BOOKS[book].chapters;
    if (from < 1 || to < from || to > max) {
      return { error: `${book}은(는) 1–${max}장까지 있어요. ("${part}")` };
    }
    for (let c = from; c <= to; c++) chapters.push([book, c]);
  }
  return { chapters };
}

// 서버에서 받은 장 목록이 올바른지 검사한다.
export function validChapters(chapters) {
  if (!Array.isArray(chapters) || chapters.length > 200) return false;
  return chapters.every(
    (c) =>
      Array.isArray(c) && c.length === 2 && BOOKS[c[0]] &&
      Number.isInteger(c[1]) && c[1] >= 1 && c[1] <= BOOKS[c[0]].chapters,
  );
}

// 로드맵 순서대로 하루 perDay장씩 묶은 기본 읽기표
export function buildDefaultPlan(perDay = 3) {
  const all = [];
  for (const [, , books] of PARTS) {
    for (const [book, n] of books) for (let c = 1; c <= n; c++) all.push([book, c]);
  }
  const days = [];
  for (let i = 0; i < all.length; i += perDay) {
    days.push({ day: days.length + 1, chapters: all.slice(i, i + perDay) });
  }
  return days;
}

// ── 날짜 (한국 시간 기준) ─────────────────────────────
const DAY_MS = 86400000;

// 한국 시간 기준 오늘 날짜 "YYYY-MM-DD"
export function kstToday(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10);
}

// 한국 시간 기준 현재 시각 "HH:MM"
export function kstTime(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(11, 16);
}

// 시작일이 DAY 1일 때 date는 DAY 몇인가 (시작 전이면 0 이하)
export function dayIndex(startDate, date) {
  return Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / DAY_MS) + 1;
}

// DAY n의 날짜 "YYYY-MM-DD"
export function dateOfDay(startDate, day) {
  return new Date(Date.parse(startDate + "T00:00:00Z") + (day - 1) * DAY_MS).toISOString().slice(0, 10);
}

// 하루 분량을 모두 체크했는가 (쉬는 날은 완료로 본다)
export function isDayDone(chapters, checkedKeys) {
  return chapters.every((c) => checkedKeys.has(chapterKey(c)));
}
