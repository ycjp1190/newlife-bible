// 진도 계산과 알림 대상 판단 (DB와 무관한 순수 함수 — 테스트하기 쉽게 분리)
import { chapterKey, dayIndex, formatChapters, isDayDone, streakDays } from "../public/shared/bible.js";

export const SLOTS = ["morning", "lunch", "evening"];
const CATCH_UP_MINUTES = 60; // 서버 예약 실행이 늦어져도 60분 안이면 보낸다

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// plan: [{day, chapters}] (day 오름차순), checked: Map<day, Set<chapterKey>>
export function progress(plan, startDate, today, checked) {
  const total = plan.length;
  const todayDay = startDate ? dayIndex(startDate, today) : null;
  const done = (d) => isDayDone(d.chapters, checked.get(d.day) || new Set());
  const missed = [];
  let doneDays = 0;
  for (const d of plan) {
    const ok = done(d);
    if (ok) doneDays++;
    else if (todayDay !== null && d.day < todayDay) missed.push(d.day);
  }
  const todayPlan = todayDay >= 1 && todayDay <= total ? plan[todayDay - 1] : null;
  let todayRemaining = [];
  if (todayPlan) {
    const set = checked.get(todayPlan.day) || new Set();
    todayRemaining = todayPlan.chapters.filter((c) => !set.has(chapterKey(c)));
  }
  return {
    total, todayDay, doneDays, missed,
    todayChapters: todayPlan ? todayPlan.chapters : [],
    todayRemaining,
    todayDone: todayPlan ? todayRemaining.length === 0 : null,
    streak: streakDays(todayDay, total, (day) => done(plan[day - 1])),
  };
}

// 지금(nowHHMM) 보내야 할 알림 칸 목록. sent: Set<slot> (오늘 이미 보낸 칸)
export function dueSlots(member, nowHHMM, sent) {
  const now = toMinutes(nowHHMM);
  return SLOTS.filter((slot) => {
    if (!member[`${slot}_on`] || sent.has(slot)) return false;
    const diff = now - toMinutes(member[slot]);
    return diff >= 0 && diff < CATCH_UP_MINUTES;
  });
}

// 알림 문구. 보낼 필요가 없으면 null
export function buildMessage(slot, prog) {
  if (!prog.todayChapters.length) return null; // 시작 전·완주 후·쉬는 날
  const day = `DAY ${prog.todayDay}`;
  const missedNote = prog.missed.length ? ` · 밀린 읽기 ${prog.missed.length}일` : "";
  if (slot === "morning") {
    return {
      title: `오늘의 말씀 · ${day}`,
      body: `${formatChapters(prog.todayChapters)}${missedNote}`,
    };
  }
  if (prog.todayDone) return null; // 점심·저녁은 아직 다 못 읽은 사람에게만
  const left = `${prog.todayRemaining.length}장 남았어요: ${formatChapters(prog.todayRemaining)}`;
  return slot === "lunch"
    ? { title: `잠깐 말씀 한 장 어때요? · ${day}`, body: `${left}${missedNote}` }
    : { title: `오늘의 말씀, 아직 남았어요 · ${day}`, body: `${left}${missedNote}` };
}
