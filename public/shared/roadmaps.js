// 읽기 로드맵(통독 순서) 정의와 읽기표 만들기. 화면과 서버가 같이 쓴다.
// - flow397 : 예수님에서 시작하는 통독 (397일 로드맵의 순서, 모임용 기본값)
// - gospelA : 복음서가 문을 여는 통독 (성경통독 로드맵 A)
// - chrono  : 시간 순서 통독 (「어? 성경이 읽어지네!」 읽는 순서. 하루 분량은 사용자가 정함)
// - community : 333 공동체성경읽기 (365일 플랜, 달력 날짜 기준, 영상 링크, 수정 불가)
// - mcheyne : 맥체인 성경읽기 (달력 날짜 기준, 하루 4곳, 수정 불가)
// community·mcheyne 는 '달력형'(fixed): 1월 1일부터 날짜별 본문이 정해져 있고 읽기표를 바꿀 수 없다.
import { BOOKS, PARTS, chapterKey } from "./bible.js";
import { MCHEYNE } from "./mcheyne.js";
import { COMMUNITY, COMMUNITY_PLAYLIST } from "./community.js";
import { EOSEONG } from "./eoseong.js";

const TOTAL_CHAPTERS = 1189;
const DAY_MS = 86400000;

// 구간: [제목, [읽기 단위...]]. 읽기 단위는 "책" (전체) 또는 ["책", 시작장, 끝장]
const GOSPEL_A = [
  ["율법과 완성", ["마가복음", "창세기", "출애굽기", "레위기", "민수기", "신명기", "히브리서", "갈라디아서"]],
  ["왕국과 참 왕", ["마태복음", "여호수아", "사사기", "룻기", "사무엘상", "사무엘하", "열왕기상", "열왕기하", "역대상", "역대하", "에스라", "느헤미야", "에스더", "로마서"]],
  ["선지자와 성령의 시대", ["누가복음", "이사야", "예레미야", "예레미야애가", "에스겔", "다니엘", "호세아", "요엘", "아모스", "오바댜", "요나", "미가", "나훔", "하박국", "스바냐", "학개", "스가랴", "말라기", "사도행전"]],
  ["지혜와 사랑", ["요한복음", "욥기", "시편", "잠언", "전도서", "아가", "요한일서", "요한이서", "요한삼서"]],
  ["교회와 완성", ["야고보서", "고린도전서", "고린도후서", "에베소서", "빌립보서", "골로새서", "데살로니가전서", "데살로니가후서", "디모데전서", "디모데후서", "디도서", "빌레몬서", "베드로전서", "베드로후서", "유다서", "요한계시록"]],
];

// 시간 순서 통독 = 「어? 성경이 읽어지네!」 순서 (data/eoseong-order.txt → scripts/build-eoseong.mjs → eoseong.js)
const CHRONO = EOSEONG;

export const ROADMAPS = {
  flow397: {
    id: "flow397",
    name: "예수님에서 시작하는 통독",
    icon: "cross",
    intro: "누가복음으로 예수님을 먼저 만나고, 복음 → 구약의 큰 이야기 → 다시 예수님 → 새 창조로 이어져요.",
    forWhom: "처음 읽는 분께",
    sections: PARTS.map(([, title, books]) => [title, books.map(([b]) => b)]),
    label: (n, title) => `${String(n).padStart(2, "0")} · ${title}`,
  },
  gospelA: {
    id: "gospelA",
    name: "복음서가 문을 여는 통독",
    icon: "door",
    intro: "구약을 네 덩어리로 나눠 복음서로 열고 서신으로 닫아요. 예수님이 구약 전체를 자신에 대한 기록이라 하신 말씀(눅 24:27, 요 5:39)에 근거해요.",
    forWhom: "복음 중심으로 구약을 읽고 싶은 분께",
    sections: GOSPEL_A,
    label: (n, title) => `구간 ${n} · ${title}`,
  },
  chrono: {
    id: "chrono",
    name: "시간 순서 통독",
    icon: "timeline",
    intro: "「어? 성경이 읽어지네!」의 읽는 순서를 따라요. 역사서를 뼈대로 시편·선지서·서신서를 그 사건 자리에 끼워 읽고, 복음서는 네 권을 사건 순서로 엮어 읽어요.",
    forWhom: "큰 줄거리와 시대 배경을 잡고 싶은 분께",
    sections: CHRONO,
    label: (n, title) => `시대 ${n} · ${title}`,
  },
  community: {
    id: "community",
    name: "333 공동체성경읽기",
    icon: "users",
    fixed: true,
    intro: "333 경건운동은 하루 성경 3장, 일주일에 새벽기도 3번, 복음 전하기 3번을 실천하는 운동이에요. 이 모드는 그중 '하루 성경 3장'을 공동체성경읽기 365일 플랜에 따라 함께 읽도록 도와요. 매일 성경 몇 장과 시편 1편을 읽어 1년에 성경 전체를 읽고, 그날 본문 영상도 볼 수 있어요.",
    forWhom: "달력 날짜 기준 · 오늘 본문 영상 · 수정 불가",
    note: "달력 날짜 기준(1월 1일 = 1일차)이라 오늘 날짜의 본문부터 시작하고, 읽기표는 바꿀 수 없어요.",
    summary: "달력 날짜 기준 · 성경 몇 장 + 시편 1편",
  },
  mcheyne: {
    id: "mcheyne",
    name: "맥체인 성경읽기",
    icon: "calendar",
    fixed: true,
    intro: "맥체인 성경읽기표에 따라 매일 4곳을 읽어요. 1년에 구약은 한 번, 신약과 시편은 두 번 읽게 돼요.",
    forWhom: "달력 날짜 기준 · 하루 4곳 · 수정 불가",
    note: "달력 날짜 기준이라 오늘 날짜의 본문부터 시작하고, 읽기표는 바꿀 수 없어요.",
    summary: "달력 날짜 기준 · 하루 4곳",
  },
};
export const ROADMAP_ORDER = ["flow397", "gospelA", "chrono", "community", "mcheyne"];
export const PER_DAY_CHOICES = [1, 2, 3, 4, 5, 7, 10];
export const isRoadmap = (id) => Object.hasOwn(ROADMAPS, id);
export const isFixed = (id) => !!ROADMAPS[id]?.fixed;

// 로드맵의 읽는 순서 → [{ item: [책, 장], section }]
const seqCache = {};
export function chapterSequence(id) {
  if (seqCache[id]) return seqCache[id];
  const out = [];
  ROADMAPS[id].sections.forEach(([, units], si) => {
    for (const u of units) {
      const [book, from, to] = typeof u === "string" ? [u, 1, BOOKS[u].chapters] : u;
      for (let c = from; c <= to; c++) out.push({ item: [book, c], section: si + 1 });
    }
  });
  return (seqCache[id] = out);
}

// 하루 perDay 장이면 1독에 며칠
export const daysNeeded = (id, perDay) => (isFixed(id) ? 365 : Math.ceil(TOTAL_CHAPTERS / perDay));

const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

// 1월 1일 = 1
export const dayOfYear = (date) => Math.round((Date.parse(date + "T00:00:00Z") - Date.parse(date.slice(0, 4) + "-01-01T00:00:00Z")) / DAY_MS) + 1;

// 달력형 로드맵의 그 날짜 본문
// - 맥체인: 월-일로 찾음 (2월 29일은 윤년에만 있는 추가 분량)
// - 공동체성경읽기: 1월 1일 = 1일차. 윤년의 366번째 날(12월 31일)은 본문 없음 = 밀린 읽기 하는 날
export function readingsOn(id, date) {
  if (id === "mcheyne") return MCHEYNE[date.slice(5)] || [];
  if (id === "community") return COMMUNITY[dayOfYear(date) - 1]?.chapters || [];
  return [];
}

// 공동체성경읽기 그 날짜의 유튜브 영상 주소 (없으면 null)
export function videoOn(id, date) {
  if (id !== "community") return null;
  const v = COMMUNITY[dayOfYear(date) - 1]?.video;
  return v ? `https://www.youtube.com/watch?v=${v}&list=${COMMUNITY_PLAYLIST}` : null;
}

// 달력형: 시작일(1일차)부터 fromDay~toDay 일차의 날짜별 본문
export function fixedDays(id, startDate, fromDay, toDay) {
  const days = [];
  for (let d = fromDay; d <= toDay; d++) days.push({ day: d, chapters: readingsOn(id, addDays(startDate, d - 1)) });
  return days;
}

// 달력형 1년치 일수: 시작일부터 1년 뒤 같은 날 전날까지 (윤년이면 366)
export function yearLength(startDate) {
  const next = String(Number(startDate.slice(0, 4)) + 1) + startDate.slice(4);
  const end = startDate.slice(5) === "02-29" ? next.slice(0, 5) + "03-01" : next;
  return Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(startDate + "T00:00:00Z")) / DAY_MS);
}

// 읽기표 만들기 → [{ day, chapters }]
export function buildPlan(id, perDay, startDate) {
  if (isFixed(id)) return fixedDays(id, startDate, 1, yearLength(startDate));
  const seq = chapterSequence(id);
  const days = [];
  for (let i = 0; i < seq.length; i += perDay) {
    days.push({ day: days.length + 1, chapters: seq.slice(i, i + perDay).map((s) => s.item) });
  }
  return days;
}

// 그날 첫 장이 속한 구간 이름. 예: "01 · 예수님에게서 시작하다", "구간 2 · 왕국과 참 왕"
const sectionMaps = {};
export function sectionLabel(id, chapters) {
  if (!chapters || !chapters.length) return "쉬는 날";
  if (id === "mcheyne") return "맥체인 성경읽기";
  if (id === "community") return "333 · 공동체성경읽기";
  const rm = ROADMAPS[id] || ROADMAPS.flow397;
  if (!sectionMaps[rm.id]) {
    sectionMaps[rm.id] = new Map(chapterSequence(rm.id).map((s) => [chapterKey(s.item), s.section]));
  }
  const n = sectionMaps[rm.id].get(chapterKey([chapters[0][0], chapters[0][1]]));
  return n ? rm.label(n, rm.sections[n - 1][0]) : "";
}
