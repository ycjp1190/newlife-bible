// "말씀 읽고 새 인생" 앱 화면
import {
  chapterKey, dateOfDaySched, dayOnDate, EVERY_DAY, formatChapters, isDayDone, itemLabel, kstToday, maskCount,
  MIN_READ_DAYS, parseChapters, streakDays, validMask, weekdaysText,
} from "./shared/bible.js";
import { latestNotice, LATEST_NOTICE, NOTICES, noticesFor } from "./shared/notices.js";
import { celebrate } from "./celebrate.js";
import {
  dayOfYear, daysNeeded, isFixed, PER_DAY_CHOICES, readingsOn, ROADMAP_ORDER, ROADMAPS, sectionLabel, videoOn,
} from "./shared/roadmaps.js";

// ── 기본 도구 ─────────────────────────────────────────
const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* 저장 불가 환경 */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* 저장 불가 환경 */ } },
};

const S = {
  token: store.get("token"),
  me: null, plan: [], startDate: null, today: kstToday(), checks: new Map(),
  vapid: null, loaded: false, tab: store.get("tab") || "today",
  mode: store.get("mode") || "group", joinView: "new",
  roadmap: "flow397", perDay: 3,
  readDays: EVERY_DAY, sched: null, noticeSeen: 999, // 읽는 요일·일정(개인: 나만, 모임: 공통), 확인한 업데이트 소식 번호
  wdDraft: EVERY_DAY, // 설정의 '요일 바꾸기' 창에서 고르는 중인 요일
  admin: null, // 관리자 탭 통계 (개인 모드, 관리자 코드를 넣은 기기만)
  chatUnread: 0, chatDraft: "", chat: { msgs: [], loaded: false, more: false, reads: [] },
  pick: null, // 개인 모드 계획 고르기 { step, context: "join"|"change", name, roadmap, perDay, readDays, start }
  members: null, showAllMissed: false, push: "unknown",
};

// 개인 모드(혼자 읽기)인지. 모임 모드에서만 "모두에게 적용" 같은 문구를 보여 준다.
const personal = () => S.mode === "personal";
const forAll = (text) => (personal() ? "" : text);
// 맥체인처럼 읽기표를 바꿀 수 없는 계획인지
const fixedPlan = () => personal() && isFixed(S.roadmap);
// 앱 이름 (개인 모드는 뒤에 "개인용")
const appName = () => (personal() ? "말씀 읽고 새 인생 (개인용)" : "말씀 읽고 새 인생");
const homeName = () => (personal() ? "말씀 새 인생 개인용" : "말씀 새 인생");
const brandHtml = () => `<h1 class="brand">말씀 읽고<br>새 인생</h1>${personal() ? `<p class="center mt"><span class="chip gold">개인용</span></p>` : ""}`;

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];
function niceDate(iso, withYear = false) {
  const d = new Date(iso + "T00:00:00Z");
  const base = `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
  return withYear ? `${d.getUTCFullYear()}년 ${base}` : base;
}
const pad2 = (n) => String(n).padStart(2, "0");

let toastTimer;
function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-App-Mode": isStandalone() ? "standalone" : "browser", // 홈 화면 앱으로 열었는지 (개인용 관리자 통계용)
        ...(S.token ? { Authorization: "Bearer " + S.token } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("인터넷 연결을 확인해 주세요.");
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== "/join") { signOut(true); throw new Error(data.error || "다시 입장해 주세요."); }
  if (!res.ok) throw new Error(data.error || "문제가 생겼어요.");
  return data;
}

// ── 계산 ──────────────────────────────────────────────
const total = () => S.plan.length;
// 날짜 ↔ DAY: 개인 모드는 읽는 요일 일정, 모임 모드는 시작일부터 매일
const schedNow = () => S.sched || S.startDate;
const todayDay = () => (S.startDate ? dayOnDate(schedNow(), S.today).day : null);
const restToday = () => (S.startDate ? dayOnDate(schedNow(), S.today).rest : false); // 오늘이 쉬는 요일인지
const dateOf = (day) => dateOfDaySched(schedNow(), day);
const unseenNotices = () => noticesFor(personal()).filter((n) => n.id > S.noticeSeen).length;
const dayPlan = (day) => S.plan[day - 1];
const checkedSet = (day) => S.checks.get(day) || new Set();
const dayDone = (day) => isDayDone(dayPlan(day).chapters, checkedSet(day));
const streak = () => streakDays(todayDay(), total(), (d) => dayDone(d));
// 모임 중도 참여자: 이 DAY 부터 모임과 같이 읽음 (그 전 날은 밀린 읽기가 아니라 '참여 전 분량', 선택)
const joinDay = () => (personal() ? 1 : S.me?.joinDay || 1);
function missedDays() {
  const t = todayDay();
  if (!t) return [];
  const out = [];
  for (let d = joinDay(); d < Math.min(t, total() + 1); d++) if (!dayDone(d)) out.push(d);
  return out;
}
// 참여 전 분량 중 아직 안 읽은 날 수
function beforeJoinLeft() {
  let n = 0;
  for (let d = 1; d < Math.min(joinDay(), total() + 1); d++) if (!dayDone(d)) n++;
  return n;
}
const partLabel = (chapters) => sectionLabel(S.roadmap, chapters);
const monthDay = (iso) => `${Number(iso.slice(5, 7))}월 ${Number(iso.slice(8, 10))}일`;

// ── 데이터 불러오기 ───────────────────────────────────
async function loadState() {
  const data = await api("/state");
  S.me = data.me;
  if (data.mode) S.mode = data.mode;
  S.plan = data.plan;
  S.roadmap = data.roadmap || "flow397";
  S.perDay = data.perDay || 3;
  S.readDays = data.readDays ?? EVERY_DAY;
  S.sched = data.sched || null;
  S.noticeSeen = data.noticeSeen ?? latestNotice(personal());
  S.startDate = data.startDate;
  S.today = data.today;
  S.vapid = data.vapidPublicKey;
  S.chatUnread = data.chatUnread || 0;
  S.checks = new Map(Object.entries(data.checks).map(([d, keys]) => [Number(d), new Set(keys)]));
  S.loaded = true;
}

async function refresh() {
  try { await loadState(); render(); } catch (e) { toast(e.message); }
}

// ── 알림(푸시) ────────────────────────────────────────
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

async function detectPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    S.push = isIOS() && !isStandalone() ? "need-install" : "unsupported";
    return;
  }
  if (Notification.permission === "denied") { S.push = "denied"; return; }
  const reg = await Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("service worker not ready")), 5000)),
  ]);
  const sub = await reg.pushManager.getSubscription();
  S.push = sub && Notification.permission === "granted" ? "on" : "off";
  // 이 기기의 구독을 현재 사용자에게 다시 연결 (재입장 등 대비)
  if (sub && S.token) api("/push/subscribe", { method: "POST", body: sub.toJSON() }).catch(() => {});
}

function b64ToBytes(b64) {
  const s = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function enablePush() {
  if (S.push === "need-install") { openInstallGuide(); return; }
  if (!S.vapid) { toast("서버에 알림 설정이 아직 안 되어 있어요."); return; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { S.push = perm === "denied" ? "denied" : "off"; render(); toast("알림이 허용되지 않았어요."); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(S.vapid) }));
    await api("/push/subscribe", { method: "POST", body: sub.toJSON() });
    S.push = "on";
    render();
    toast("알림을 켰어요 🔔");
  } catch (e) {
    toast(e.message || "알림을 켜지 못했어요.");
  }
}

async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api("/push/unsubscribe", { method: "POST", body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    S.push = "off";
    render();
    toast("이 기기의 알림을 껐어요.");
  } catch (e) { toast(e.message); }
}

// ── 공통 조각 ─────────────────────────────────────────
const CHECK_SVG = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>`;

function checksHtml(day) {
  const d = dayPlan(day);
  if (!d.chapters.length) return `<p class="muted">이 날은 쉬는 날이에요.</p>`;
  const set = checkedSet(day);
  return `<ul class="checks">${d.chapters.map((c) => {
    const key = chapterKey(c);
    const on = set.has(key);
    return `<li><button class="check" role="checkbox" aria-checked="${on}" data-action="toggle" data-day="${day}" data-key="${esc(key)}">
      <span class="box">${CHECK_SVG}</span><span class="label">${esc(itemLabel(c))}</span></button></li>`;
  }).join("")}</ul>`;
}

function pushNotice() {
  if (S.push === "on" || S.push === "unknown") return "";
  const text = {
    "need-install": "아이폰은 <b>홈 화면에 추가</b>해야 알림을 받을 수 있어요.",
    unsupported: "이 브라우저는 알림을 지원하지 않아요. 크롬이나 삼성 인터넷(갤럭시), 사파리(아이폰)에서 열어 주세요.",
    denied: "알림이 차단되어 있어요. 폰 설정에서 이 앱의 알림을 허용해 주세요.",
    off: "매일 읽을 말씀을 알림으로 받아 보세요.",
  }[S.push];
  const btn = S.push === "need-install"
    ? `<button class="btn secondary" data-action="install-guide">방법 보기</button>`
    : S.push === "off" ? `<button class="btn" data-action="push-on">알림 켜기</button>` : "";
  return `<div class="notice ${S.push === "denied" ? "warn" : ""}"><p>${text}</p>${btn}</div>`;
}

const ICONS = {
  today: `<path d="M4 5.5A1.5 1.5 0 015.5 4H11v16H5.5A1.5 1.5 0 014 18.5z M20 5.5A1.5 1.5 0 0018.5 4H13v16h5.5a1.5 1.5 0 001.5-1.5z"/>`,
  together: `<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c2.3-.3 4.4 1.2 5 4.3"/>`,
  chat: `<path d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v7a2.5 2.5 0 01-2.5 2.5H10l-4 3.5V16h0.5A2.5 2.5 0 014 13.5z"/><path d="M8.5 9.5h7M8.5 12.5h4.5"/>`,
  plan: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.4l2 1.2M17.8 15.4l2 1.2M4.2 16.6l2-1.2M17.8 8.6l2-1.2"/>`,
  admin: `<path d="M4 20h16"/><rect x="5" y="11" width="3" height="6" rx="1"/><rect x="10.5" y="7" width="3" height="10" rx="1"/><rect x="16" y="4" width="3" height="13" rx="1"/>`,
};
const TAB_NAMES = { today: "오늘", together: "함께", chat: "대화", plan: "일정", settings: "설정", admin: "관리자" };
const GROUP_ONLY_TABS = ["together", "chat"];
// 관리자 탭: 개인 모드에서 이 기기에 관리자 코드를 넣었을 때만
const hasAdmin = () => personal() && !!store.get("adminCode");

function navHtml() {
  const tabs = Object.keys(TAB_NAMES).filter((t) => !(personal() && GROUP_ONLY_TABS.includes(t)) && (t !== "admin" || hasAdmin()));
  const badge = (t) => {
    if (t === "chat" && S.chatUnread > 0 && S.tab !== "chat") {
      return `<span class="tab-badge" aria-label="안 읽은 메시지 ${S.chatUnread}개">${S.chatUnread > 99 ? "99+" : S.chatUnread}</span>`;
    }
    if (t === "settings" && unseenNotices()) return `<span class="tab-dot" aria-label="새 소식"></span>`;
    return "";
  };
  return `<nav class="tabs" aria-label="메뉴"><div class="inner" style="grid-template-columns:repeat(${tabs.length},1fr)">${tabs.map((t) => `
    <button data-action="tab" data-tab="${t}" ${S.tab === t ? 'aria-current="page"' : ""}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[t]}</svg>
      ${TAB_NAMES[t]}${badge(t)}</button>`).join("")}</div></nav>`;
}

// ── 화면: 입장 ────────────────────────────────────────
function renderJoin() {
  if (personal()) { renderJoinPersonal(); return; }
  const invite = new URLSearchParams(location.search).get("invite") || store.get("invite") || "";
  const iosBrowser = isIOS() && !isStandalone();
  $("#app").innerHTML = `
    <section class="join">
      <h1 class="brand">말씀 읽고<br>새 인생</h1>
      <p class="tagline">397일, 함께 성경 전체를 읽어요</p>
      ${iosBrowser ? `<div class="notice"><p>아이폰은 먼저 <b>홈 화면에 추가</b>한 뒤, 홈 화면의 앱 아이콘으로 들어와서 입장해야 알림을 받을 수 있어요.</p>
        <button class="btn secondary" data-action="install-guide">방법 보기</button></div>` : ""}
      <form class="card" id="join-form">
        <label class="field"><span>이름</span>
          <input class="input" name="name" autocomplete="name" maxlength="20" required placeholder="예: 홍길동"></label>
        <label class="field"><span>초대 코드</span>
          <input class="input" name="invite" value="${esc(invite)}" required autocapitalize="off" autocomplete="off" placeholder="모임에서 받은 코드"></label>
        <button class="btn block" type="submit">입장하기</button>
        <p class="hint">전에 쓰던 이름을 그대로 적으면 기존 기록으로 이어서 사용해요.</p>
      </form>
    </section>`;
}

// 개인 모드 입장: 이름 + 시작일 / 복구 코드로 이어 쓰기
function renderJoinPersonal() {
  const iosBrowser = isIOS() && !isStandalone();
  if (!S.pick || S.pick.context !== "join") S.pick = { step: "name", context: "join", name: "", roadmap: null, perDay: 3, readDays: EVERY_DAY, start: kstToday() };
  const form = S.joinView === "recover"
    ? `<form class="card" id="recover-form">
        <label class="field"><span>복구 코드</span>
          <input class="input" name="code" required autocapitalize="characters" autocomplete="off" placeholder="예: K7MX-Q2PD"></label>
        <button class="btn block" type="submit">내 기록 이어서 쓰기</button>
        <p class="hint">처음 시작할 때 받은 8자리 코드예요. 설정 화면에서도 볼 수 있어요.</p>
        <button class="btn ghost block mt" type="button" data-action="join-view" data-view="new">처음 시작하기로 돌아가기</button>
      </form>`
    : `<div class="card">${pickerHtml()}</div>`;
  $("#app").innerHTML = `
    <section class="join">
      ${brandHtml()}
      <p class="tagline">나에게 맞는 순서와 분량으로 성경 전체를 읽어요</p>
      ${iosBrowser ? `<div class="notice"><p>아이폰은 먼저 <b>홈 화면에 추가</b>한 뒤, 홈 화면의 앱 아이콘으로 들어와서 시작해야 알림을 받을 수 있어요.</p>
        <button class="btn secondary" data-action="install-guide">방법 보기</button></div>` : ""}
      ${form}
    </section>`;
}

async function finishJoin(data, welcome) {
  S.token = data.token;
  store.set("token", data.token);
  history.replaceState(null, "", "/");
  await loadState();
  await detectPush().catch(() => {});
  render();
  toast(welcome);
}

// ── 계획 고르기 (개인 모드 시작 화면·설정의 '계획 바꾸기'에서 같이 씀) ──
// 단계: name(시작할 때만) → roadmap → perday → weekdays → start (달력형은 mcstart 하나)
function pickSteps() {
  const p = S.pick;
  const base = p.context === "join" ? ["name", "roadmap"] : ["roadmap"];
  return p.roadmap && isFixed(p.roadmap) ? [...base, "mcstart"] : [...base, "perday", "weekdays", "start"];
}

// 요일 고르기 버튼 (월요일부터)
function weekdayChips(mask, action) {
  return `<div class="pick-chips wd-chips">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<button class="pchip ${(mask >> i) & 1 ? "on" : ""}" type="button"
    data-action="${action}" data-i="${i}" aria-pressed="${!!((mask >> i) & 1)}">${WEEK[i]}</button>`).join("")}</div>
    ${validMask(mask) ? "" : `<p class="hint error">${MIN_READ_DAYS}일 이상 골라 주세요. (지금 ${maskCount(mask)}일)</p>`}`;
}

function durationText(days) {
  const y = Math.floor(days / 365);
  const m = Math.round((days % 365) / 30.4);
  const parts = [y ? `${y}년` : "", m ? `${m}개월` : ""].filter(Boolean);
  return parts.length ? `약 ${parts.join(" ")}` : `${days}일`;
}

function planSummaryHtml(p) {
  const days = daysNeeded(p.roadmap, p.perDay);
  const mask = validMask(p.readDays) ? p.readDays : EVERY_DAY;
  const end = dateOfDaySched([{ date: p.start, day: 1, mask }], days);
  const span = Math.round((Date.parse(end) - Date.parse(p.start)) / 86400000) + 1; // 쉬는 요일 포함 달력 날 수
  return `<div class="pick-summary">
    <p>하루 <b>${p.perDay}장</b>${mask === EVERY_DAY ? "" : ` · <b>${weekdaysText(mask)}</b>`}이면 1독에 ${mask === EVERY_DAY ? "" : "읽는 날 "}<b>${days.toLocaleString()}일</b>(${durationText(span)}) 걸려요.</p>
    <p class="muted">${niceDate(p.start, true)}에 시작하면 <b>${niceDate(end, true)}</b>에 끝나요.</p>
  </div>`;
}

function pickerHtml() {
  const p = S.pick;
  const steps = pickSteps();
  const idx = steps.indexOf(p.step);
  const dots = `<div class="pick-dots" aria-hidden="true">${steps.map((_, i) => `<i class="${i <= idx ? "on" : ""} ${i === idx ? "now" : ""}"></i>`).join("")}</div>
    <p class="pick-step">${idx + 1} / ${steps.length} 단계</p>`;
  const back = idx > 0 ? `<button class="btn secondary" type="button" data-action="pick-back">이전</button>` : "";
  const finish = p.context === "join" ? "시작하기" : "이 계획으로 바꾸기";

  if (p.step === "name") {
    return `${dots}<form id="pick-name-form">
      <p class="pick-q">이름을 알려 주세요</p>
      <input class="input" name="name" value="${esc(p.name)}" autocomplete="name" maxlength="20" required placeholder="예: 홍길동">
      <button class="btn block mt" type="submit">다음</button>
      <button class="btn ghost block mt" type="button" data-action="join-view" data-view="recover">전에 쓰던 기록이 있어요</button>
    </form>`;
  }
  if (p.step === "roadmap") {
    return `${dots}<p class="pick-q">어떤 순서로 읽을까요?</p>
      ${ROADMAP_ORDER.map((id) => {
        const r = ROADMAPS[id];
        return `<button class="rm ${p.roadmap === id ? "on" : ""}" type="button" data-action="pick-roadmap" data-id="${id}">
          <span class="rm-title">${esc(r.name)}${S.pick.context === "change" && S.roadmap === id ? ` <span class="chip">지금 계획</span>` : ""}</span>
          <span class="rm-desc">${esc(r.intro)}</span>
          <span class="rm-tag ${r.fixed ? "fixed" : ""}">${esc(r.forWhom)}</span>
        </button>`;
      }).join("")}
      ${back ? `<div class="btn-row">${back}</div>` : ""}`;
  }
  if (p.step === "perday") {
    return `${dots}<p class="pick-q">하루에 몇 장 읽으실 건가요?</p>
      <p class="muted" style="margin:-6px 0 12px">${esc(ROADMAPS[p.roadmap].name)}</p>
      <div class="pick-chips">${PER_DAY_CHOICES.map((n) => `<button class="pchip ${p.perDay === n ? "on" : ""}" type="button" data-action="pick-perday" data-n="${n}">${n}장</button>`).join("")}</div>
      ${planSummaryHtml(p)}
      <div class="btn-row">${back}<button class="btn grow" type="button" data-action="pick-next">다음: 읽는 요일</button></div>`;
  }
  if (p.step === "weekdays") {
    return `${dots}<p class="pick-q">어느 요일에 읽으실 건가요?</p>
      <p class="muted" style="margin:-6px 0 12px">생활에 맞게 ${MIN_READ_DAYS}일 이상 골라 주세요. 쉬는 요일에는 알림이 오지 않아요.</p>
      ${weekdayChips(p.readDays, "pick-wd")}
      ${planSummaryHtml(p)}
      <div class="btn-row">${back}<button class="btn grow" type="button" data-action="pick-next" ${validMask(p.readDays) ? "" : "disabled"}>다음: 시작일</button></div>`;
  }
  if (p.step === "start") {
    return `${dots}<p class="pick-q">언제부터 읽을까요?</p>
      <p class="muted" style="margin:-6px 0 12px">${esc(ROADMAPS[p.roadmap].name)} · 하루 ${p.perDay}장 · ${weekdaysText(p.readDays)}</p>
      <input class="input" type="date" id="pick-start" value="${esc(p.start)}" required>
      ${planSummaryHtml(p)}
      ${p.context === "change" ? `<p class="hint">새 계획으로 DAY 1부터 다시 시작해요. 지금까지의 체크 기록은 보관돼요.</p>` : ""}
      <div class="btn-row">${back}<button class="btn grow" type="button" data-action="pick-submit">${finish}</button></div>`;
  }
  // mcstart: 맥체인은 오늘 날짜 본문부터
  const today = kstToday();
  const readings = readingsOn(p.roadmap, today);
  return `${dots}<p class="pick-q">오늘 날짜 본문부터 시작해요</p>
    <p class="muted" style="margin:-6px 0 12px">${esc(ROADMAPS[p.roadmap].name)} · ${esc(ROADMAPS[p.roadmap].note)}</p>
    <div class="pick-summary"><p class="muted" style="margin:0 0 6px">${monthDay(today)} 본문${p.roadmap === "community" ? ` · ${dayOfYear(today)}일차` : ""}</p>
      <ul class="plain">${readings.map((c) => `<li>${esc(itemLabel(c))}</li>`).join("")}</ul></div>
    <p class="hint">하루 분량은 읽기표대로 정해져 있어 따로 고르지 않아요.${p.context === "change" ? " 지금까지의 체크 기록은 보관돼요." : ""}</p>
    <div class="btn-row">${back}<button class="btn grow" type="button" data-action="pick-submit">${finish}</button></div>`;
}

function rerenderPicker() {
  if (S.pick.context === "join") render();
  else openSheet(pickerHtml());
}

function pickGo(delta) {
  const steps = pickSteps();
  S.pick.step = steps[Math.max(0, Math.min(steps.length - 1, steps.indexOf(S.pick.step) + delta))];
  rerenderPicker();
}

function openPlanChange() {
  S.pick = { step: "roadmap", context: "change", roadmap: S.roadmap, perDay: S.perDay, readDays: S.readDays, start: kstToday() };
  openSheet(pickerHtml());
}

async function submitPick(btn) {
  const p = S.pick;
  const start = isFixed(p.roadmap) ? kstToday() : p.start;
  const body = { roadmap: p.roadmap, per_day: p.perDay, read_days: isFixed(p.roadmap) ? EVERY_DAY : p.readDays, start_date: start };
  btn.disabled = true;
  try {
    if (p.context === "join") {
      const data = await api("/join", { method: "POST", body: { name: p.name, ...body } });
      S.pick = null;
      await finishJoin(data, `${data.member.name}님, 함께 시작해요!`);
      openRecoveryInfo(true);
    } else {
      const label = isFixed(p.roadmap) ? ROADMAPS[p.roadmap].name : `${ROADMAPS[p.roadmap].name} · 하루 ${p.perDay}장 · ${weekdaysText(p.readDays)}`;
      if (!confirm(`'${label}'(으)로 바꿀까요?\n새 계획으로 처음부터 시작하고, 지금까지의 체크 기록은 보관돼요.`)) { btn.disabled = false; return; }
      await api("/plan/choose", { method: "PUT", body });
      S.pick = null;
      await loadState();
      closeSheet();
      S.tab = "today";
      render();
      toast("새 계획으로 시작해요!");
    }
  } catch (e) { toast(e.message); btn.disabled = false; }
}

async function submitRecover(form) {
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const data = await api("/recover", { method: "POST", body: { code: form.code.value } });
    await finishJoin(data, `${data.member.name}님, 다시 오셨네요!`);
  } catch (e) { toast(e.message); btn.disabled = false; }
}

function openRecoveryInfo(first = false) {
  const code = S.me?.recoveryCode;
  if (!code) return;
  openSheet(`
    <h3>${first ? "복구 코드를 꼭 적어 두세요" : "내 복구 코드"}</h3>
    <p class="passage" style="text-align:center;letter-spacing:2px;font-size:28px;margin:18px 0">${esc(code)}</p>
    <p class="muted">폰을 바꾸거나 앱을 지웠을 때, 이 코드로 지금까지의 기록을 그대로 이어 쓸 수 있어요.
      <b>화면을 캡처하거나 종이에 적어 두세요.</b> 다른 사람에게는 알려 주지 마세요.</p>
    <div class="btn-row">
      <button class="btn secondary" data-action="copy-code">코드 복사</button>
      <button class="btn" data-action="close-sheet">${first ? "적어 뒀어요" : "닫기"}</button>
    </div>`);
}

async function submitJoin(form) {
  const name = form.name.value.trim();
  const invite = form.invite.value.trim();
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const data = await api("/join", { method: "POST", body: { name, invite } });
    S.token = data.token;
    store.set("token", data.token);
    store.set("invite", invite);
    history.replaceState(null, "", "/");
    await loadState();
    await detectPush().catch(() => {});
    render();
    toast(`${data.member.name}님, 환영해요!`);
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  }
}

function signOut(expired = false) {
  S.token = null;
  S.loaded = false;
  store.del("token");
  render();
  if (expired) toast("다시 입장해 주세요.");
}

// 공동체성경읽기: 그날 본문 유튜브 영상 버튼
function videoButton(date) {
  const url = date && personal() ? videoOn(S.roadmap, date) : null;
  return url ? `<a class="btn secondary block mt video-btn" href="${esc(url)}" target="_blank" rel="noopener">▶ 오늘 본문 영상 보기</a>` : "";
}

// ── 화면: 오늘 ────────────────────────────────────────
function renderToday() {
  const t = todayDay();
  let main;
  if (!S.startDate) {
    main = `<div class="card"><p>아직 모임의 <b>시작일</b>이 정해지지 않았어요.</p>
      <button class="btn" data-action="tab" data-tab="settings">시작일 정하러 가기</button></div>`;
  } else if (t < 1) {
    const first = dateOf(1); // 쉬는 요일에 시작하면 첫 읽는 날
    const dLeft = Math.round((Date.parse(first) - Date.parse(S.today)) / 86400000);
    main = `<div class="card">
      <div class="today-head"><div class="day-no">D-${dLeft}</div><span class="chip gold">${niceDate(first)} 시작</span></div>
      <p class="passage">첫날 읽을 말씀: ${esc(formatChapters(dayPlan(1).chapters))}</p>
      <p class="muted">시작일이 되면 매일 아침 읽을 곳을 알려드릴게요.</p></div>`;
  } else if (t > total()) {
    main = `<div class="card"><div class="day-no">완주 🎉</div>
      <p class="passage">${total()}일의 여정이 끝났어요.</p>
      <p class="muted">${missedDays().length ? `아직 밀린 읽기 ${missedDays().length}일이 남아 있어요.` : "성경 전체를 모두 읽으셨어요. 수고하셨어요!"}</p></div>`;
  } else if (restToday()) {
    // 쉬는 요일: 다음 읽을 날 분량을 보여 주고, 미리 읽고 체크할 수 있게
    const d = dayPlan(t);
    main = `<div class="card">
      <div class="today-head"><div class="day-no">쉬는 날 <small>😌</small></div><span class="chip gold">${weekdaysText(S.readDays)} 읽기</span></div>
      <p class="muted" style="margin:0 0 10px">오늘은 쉬어 가는 요일이에요. 다음 읽기는 <b>${niceDate(dateOf(t))}</b> DAY ${t}예요.</p>
      <p class="passage">${esc(formatChapters(d.chapters))}</p>
      ${checksHtml(t)}
      ${dayDone(t) ? `<p class="done-banner">미리 다 읽었어요! 🎉</p>` : `<p class="hint">미리 읽고 체크해도 돼요.</p>`}
    </div>`;
  } else {
    const d = dayPlan(t);
    const done = dayDone(t);
    main = `<div class="card">
      <div class="today-head"><div class="day-no">${fixedPlan() ? `${monthDay(S.today)} <small>${S.roadmap === "community" ? `${dayOfYear(S.today)}일차` : "본문"}</small>` : `DAY ${t} <small>/ ${total()}</small>`}</div><span class="chip">${esc(partLabel(d.chapters))}</span></div>
      <p class="passage">${esc(formatChapters(d.chapters))}</p>
      ${checksHtml(t)}
      ${videoButton(S.today)}
      ${done
        ? `<p class="done-banner">🎉 오늘 말씀 완료!${streak() >= 2 ? `<br><span class="streak-line">🔥 ${streak()}일 연속으로 읽고 있어요</span>` : ""}</p>
          ${personal() ? `<p class="center" style="margin:6px 0 0"><button class="btn ghost" data-action="share-app">💌 친구에게도 알려 주기</button></p>` : ""}`
        : streak() >= 2 ? `<p class="streak-hint">🔥 ${streak()}일 연속 중 — 오늘도 이어 가요</p>` : ""}
    </div>`;
  }

  const missed = missedDays();
  const shown = S.showAllMissed ? missed : missed.slice(0, 5);
  const missedHtml = missed.length ? `
    <h2 class="section">밀린 읽기 <small class="chip warn">${missed.length}일</small></h2>
    <div class="card"><ul class="list">${shown.map((day) => dayRowHtml(day)).join("")}</ul>
      ${missed.length > 5 ? `<button class="btn ghost" data-action="toggle-missed">${S.showAllMissed ? "접기" : `모두 보기 (${missed.length}일)`}</button>` : ""}
    </div>` : "";

  $("#app").innerHTML = `
    <header class="top"><h1>${appName()}</h1><span class="date">${niceDate(S.today)}</span></header>
    ${pushNotice()}
    ${main}
    ${aheadHtml()}
    ${missedHtml}
    ${beforeJoinLeft() ? `<p class="hint mt">DAY ${joinDay()}부터 모임에 참여했어요. 그 전 분량 ${beforeJoinLeft()}일은 밀린 읽기에 들어가지 않아요. 원하면 <button class="link-btn" data-action="tab" data-tab="plan">일정 탭</button>에서 따로 읽을 수 있어요.</p>` : ""}
    ${navHtml()}`;
}

// 오늘 분량보다 앞서 미리 읽은 곳: "DAY 8 (10월 11일)의 누가복음 23장까지 미리 읽었어요"
function aheadHtml() {
  const t = todayDay();
  if (t === null || t >= total()) return "";
  const base = Math.max(t, 0); // 이 DAY 다음부터가 '미리'
  let far = 0;
  let count = 0;
  for (let d = base + 1; d <= total(); d++) {
    const n = dayPlan(d).chapters.filter((c) => checkedSet(d).has(chapterKey(c))).length;
    if (n) { far = d; count += n; }
  }
  if (!far) return "";
  const label = `${fixedPlan() ? `${monthDay(dateOf(far))} 본문` : `DAY ${far} (${monthDay(dateOf(far))})`}`;
  let gap = false; // 미리 읽은 마지막 날 앞에 빠뜨린 날이 있는지
  for (let d = base + 1; d < far; d++) if (!dayDone(d)) { gap = true; break; }
  const allDone = !gap && dayDone(far);
  const chapters = dayPlan(far).chapters.filter((c) => checkedSet(far).has(chapterKey(c)));
  const text = allDone ? `<b>${label}</b>까지 미리 다 읽었어요`
    : `<b>${label}</b>의 <b>${esc(itemLabel(chapters.at(-1)))}</b>까지 미리 읽었어요`;
  return `<button class="ahead" data-action="open-day" data-day="${far}">🚀 ${text}
    <small>오늘 이후 분량 ${count}장 체크${gap ? " · 중간에 건너뛴 날이 있어요 (일정 탭에서 확인)" : ""}</small></button>`;
}

function dayRowHtml(day) {
  const d = dayPlan(day);
  const t = todayDay();
  const done = dayDone(day);
  const set = checkedSet(day);
  const partial = d.chapters.filter((c) => set.has(chapterKey(c))).length;
  const isMissed = !done && t && day < t && day >= joinDay();
  const mark = done ? "✓" : partial ? `${partial}/${d.chapters.length}` : isMissed ? "•" : "";
  const date = S.startDate ? niceDate(dateOf(day)) : "";
  return `<li><button class="row ${day === t ? "is-today" : ""} ${isMissed ? "missed" : ""}" data-action="open-day" data-day="${day}" id="day-${day}">
    <span class="main"><span class="title">${fixedPlan() ? "" : `DAY ${day} · `}${esc(formatChapters(d.chapters))}</span>
    <span class="sub">${date}${day === t ? (restToday() ? " · 다음 읽기" : " · 오늘") : ""}</span></span>
    <span class="mark" aria-label="${done ? "완료" : isMissed ? "밀림" : ""}">${mark}</span></button></li>`;
}

// ── 화면: 함께 ────────────────────────────────────────
async function loadMembers() {
  try {
    const data = await api("/members");
    S.members = data.members;
    if (S.tab === "together") render();
  } catch (e) { toast(e.message); }
}

function renderTogether() {
  const list = S.members;
  let body;
  if (!list) body = `<p class="empty">불러오는 중…</p>`;
  else if (!list.length) body = `<p class="empty">아직 아무도 없어요.</p>`;
  else {
    const sorted = [...list].sort((a, b) => (a.missedChapters ?? 0) - (b.missedChapters ?? 0) || b.doneDays - a.doneDays || a.name.localeCompare(b.name, "ko"));
    body = sorted.map((m) => {
      // 진행률은 항상 소수점 두 자리 (1/397일 = 0.25%), 1일이라도 읽었으면 막대가 보이게
      const raw = m.total ? (m.doneDays / m.total) * 100 : 0;
      const pct = raw.toFixed(2);
      const bar = raw > 0 ? Math.max(raw, 2) : 0;
      const today = m.todayTotal ? (m.todayDone ? `<span class="chip done">🎉 오늘 완료</span>` : `<span class="chip gold">오늘 ${m.todayChecked}/${m.todayTotal}</span>`) : "";
      const fire = m.streak >= 2 ? ` <span class="chip fire">🔥 ${m.streak}일</span>` : "";
      const missed = m.missedDays ? `<span class="chip warn">밀린 ${m.missedChapters}장 · ${m.missedDays}일</span>` : `<span class="chip">밀린 날 없음</span>`;
      const month = m.thisMonth?.chapters ? ` · 이번 달 밀린 ${m.thisMonth.chapters}장` : "";
      const joined = m.joinDay > 1 ? ` · DAY ${m.joinDay}부터 참여` : "";
      return `<div class="member" role="button" tabindex="0" data-action="member" data-id="${m.id}" aria-label="${esc(m.name)} 자세히 보기">
        <div class="line1"><span class="name">${esc(m.name)}${m.id === S.me.id ? ` <span class="me">(나)</span>` : ""}${fire}</span><span class="chips">${missed} ${today}</span></div>
        <div class="progress" aria-label="진행률 ${pct}%"><i style="width:${bar}%"></i></div>
        <div class="line2"><span>${m.doneDays} / ${m.total}일 완료${month}${joined}</span><span>${pct}% <span class="chev" aria-hidden="true">›</span></span></div>
      </div>`;
    }).join("");
  }
  $("#app").innerHTML = `
    <header class="top"><h1>함께 읽기</h1><span class="date">${list ? `${list.length}명` : ""}</span></header>
    <div class="card">${body}</div>
    <p class="hint">이름을 누르면 어느 장을 밀렸는지 볼 수 있어요.<br>밀린 장 = 어제까지의 날짜 중 아직 체크하지 않은 장 (나중에 체크하면 빠져요)</p>
    ${navHtml()}`;
}

// 한 사람의 밀린 장 자세히 (벌금 정산용)
const monthName = (ym) => (ym.slice(0, 4) === S.today.slice(0, 4) ? `${Number(ym.slice(5))}월` : `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`);

async function openMember(id) {
  openSheet(`<h3>불러오는 중…</h3>`);
  let d;
  try { d = await api(`/members/${id}`); } catch (e) { closeSheet(); toast(e.message); return; }
  if (!sheetOpen()) return;
  const raw = d.total ? (d.doneDays / d.total) * 100 : 0;
  const thisMonth = S.today.slice(0, 7);
  const byMonth = new Map();
  for (const x of d.missed) {
    const key = x.date.slice(0, 7);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key).push(x);
  }
  const monthChips = d.months.map((m) => `<span class="chip ${m.month === thisMonth ? "warn" : ""}">${monthName(m.month)} ${m.chapters}장 (${m.days}일)</span>`).join(" ");
  const lists = [...byMonth.entries()].map(([ym, rows]) => `
    <h2 class="section">${monthName(ym)}${ym === thisMonth ? " (이번 달)" : ""} <small>${rows.reduce((n, x) => n + x.remaining.length, 0)}장</small></h2>
    <ul class="list missed-list">${rows.map((x) => `<li class="row">
      <span class="main"><span class="title">DAY ${x.day} · ${niceDate(x.date)}</span>
      <span class="sub">${esc(formatChapters(x.remaining))}</span></span>
      <span class="mark">${x.remaining.length}장</span></li>`).join("")}</ul>`).join("");
  openSheet(`
    <h3>${esc(d.name)}${d.id === S.me.id ? ` <span class="muted" style="font-size:15px">(나)</span>` : ""}</h3>
    <p class="muted" style="margin:0 0 12px">${d.streak >= 2 ? `🔥 ${d.streak}일 연속 · ` : ""}${d.doneDays} / ${d.total}일 완료 (${raw.toFixed(2)}%)${d.joinDay > 1 ? ` · DAY ${d.joinDay}부터 참여 (그 전 분량은 밀린 장에서 빠져요)` : ""}</p>
    <div class="mm-stats">
      <div><b>${d.missedChapters}장</b><span>밀린 장</span></div>
      <div><b>${d.missedDays}일</b><span>밀린 날</span></div>
    </div>
    ${d.missed.length ? `<p class="mm-months">${monthChips}</p>${lists}` : `<p class="empty">밀린 장이 없어요 🙌</p>`}
    <p class="hint">어제까지의 날짜 중 아직 체크하지 않은 장이에요. 나중에 체크하면 목록에서 빠져요.</p>`);
}

// ── 화면: 대화 (모임 단톡방) ──────────────────────────
const REACTIONS = ["🙏", "❤️", "👍", "👏", "🙌", "😊", "😢", "🔥"]; // 공감 (화면과 서버가 같아야 함)
const kstDateOf = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const timeOf = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit" });
const nameOf = (id) => S.members?.find((m) => m.id === id)?.name || "";

function reactionsHtml(m) {
  const entries = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length);
  if (!entries.length) return "";
  return `<div class="rx-row">${entries.map(([emoji, ids]) => `<button class="rx ${ids.includes(S.me.id) ? "on" : ""}" data-action="chat-react" data-id="${m.id}" data-emoji="${emoji}" aria-label="${emoji} ${ids.length}명">${emoji} ${ids.length}</button>`).join("")}</div>`;
}

function unreadCount(m) {
  if (m.kind !== "text" || m.deleted) return 0;
  return S.chat.reads.filter((r) => r.id !== m.member_id && (r.last_read || 0) < m.id).length;
}

function chatListHtml() {
  const c = S.chat;
  if (!c.loaded) return `<p class="empty">불러오는 중…</p>`;
  if (!c.msgs.length) return `<p class="empty">아직 대화가 없어요.<br>첫 메시지를 남겨 보세요 🙂</p>`;
  let html = c.more ? `<button class="btn ghost chat-older" data-action="chat-older">이전 메시지 더 보기</button>` : "";
  let prevDate = null;
  let prevAuthor = null;
  for (const m of c.msgs) {
    const date = kstDateOf(m.created_at);
    if (date !== prevDate) {
      html += `<div class="chat-day">${niceDate(date, date.slice(0, 4) !== S.today.slice(0, 4))}</div>`;
      prevDate = date;
      prevAuthor = null;
    }
    if (m.kind === "join") { // 새 모임원 환영 인사
      html += `<div class="chat-done chat-join" data-action="chat-msg" data-id="${m.id}"><span>${esc(m.body)}</span>${reactionsHtml(m)}</div>`;
      prevAuthor = null;
      continue;
    }
    if (m.kind === "done") {
      html += `<div class="chat-done" data-action="chat-msg" data-id="${m.id}"><span>🎉 <b>${esc(m.name)}</b>님이 오늘 말씀을 다 읽었어요</span>${reactionsHtml(m)}</div>`;
      prevAuthor = null;
      continue;
    }
    const mine = m.member_id === S.me.id;
    html += `<div class="msg ${mine ? "mine" : ""}">
      ${!mine && prevAuthor !== m.member_id ? `<div class="msg-name">${esc(m.name)}</div>` : ""}
      <div class="msg-row">
        <div class="bubble ${m.deleted ? "deleted" : ""}" data-action="chat-msg" data-id="${m.id}">${m.deleted ? "삭제된 메시지예요" : esc(m.body)}</div>
        <span class="msg-meta">${unreadCount(m) ? `<b class="unread-n" aria-label="안 읽은 사람 ${unreadCount(m)}명">${unreadCount(m)}</b>` : ""}<span class="msg-time">${timeOf(m.created_at)}</span></span>
      </div>${reactionsHtml(m)}</div>`;
    prevAuthor = m.member_id;
  }
  return html;
}

function renderChat() {
  $("#app").innerHTML = `
    <header class="top"><h1>대화</h1><span class="date">모임 단톡방</span></header>
    <div id="chat-list" class="chat-list">${chatListHtml()}</div>
    <form id="chat-form" class="chat-form">
      <textarea class="chat-input" name="body" rows="1" maxlength="1000" placeholder="메시지 보내기" aria-label="메시지">${esc(S.chatDraft)}</textarea>
      <button class="btn" type="submit">보내기</button>
    </form>
    ${navHtml()}`;
  autoGrow($("#chat-form textarea"));
  if (!S.chat.loaded) loadChat();
  else { scrollChatToBottom(); markChatRead(); }
  if (!S.members) loadMembers();
}

const nearBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
const scrollChatToBottom = () => window.scrollTo(0, document.documentElement.scrollHeight);
function autoGrow(t) {
  if (!t) return;
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
}

function updateChatList({ toBottom = false } = {}) {
  const el = $("#chat-list");
  if (!el) return;
  const stick = toBottom || nearBottom();
  el.innerHTML = chatListHtml();
  if (stick) scrollChatToBottom();
}

async function markChatRead() {
  const last = S.chat.msgs.at(-1);
  if (!last || S.tab !== "chat" || document.visibilityState !== "visible") return;
  const had = S.chatUnread;
  S.chatUnread = 0;
  if (had) { const nav = $("nav.tabs"); if (nav) nav.outerHTML = navHtml(); }
  api("/chat/read", { method: "POST", body: { id: last.id } }).catch(() => {});
}

async function loadChat() {
  try {
    const { messages, reads } = await api("/chat");
    S.chat = { msgs: messages, loaded: true, more: messages.length >= 100, reads: reads || [] };
    if (S.tab === "chat") { updateChatList({ toBottom: true }); markChatRead(); }
  } catch (e) { toast(e.message); }
}

async function loadOlderChat() {
  const first = S.chat.msgs[0];
  if (!first) return;
  try {
    const { messages } = await api(`/chat?before=${first.id}`);
    const before = document.documentElement.scrollHeight;
    S.chat.msgs = [...messages, ...S.chat.msgs];
    S.chat.more = messages.length >= 100;
    updateChatList();
    window.scrollTo(0, window.scrollY + document.documentElement.scrollHeight - before); // 보던 위치 유지
  } catch (e) { toast(e.message); }
}

let chatPolling = false;
async function pollChat() {
  if (chatPolling || !S.chat.loaded) return;
  chatPolling = true;
  lastChatPoll = Date.now();
  try {
    const c = S.chat;
    const last = c.msgs.at(-1)?.id || 0;
    if (!last) { await loadChat(); return; }
    const { messages, updates, reads } = await api(`/chat?after=${last}&from=${c.msgs[0].id}`);
    let changed = messages.length > 0;
    if (reads && JSON.stringify(reads) !== JSON.stringify(c.reads)) { c.reads = reads; changed = true; }
    for (const u of updates) {
      const i = c.msgs.findIndex((m) => m.id === u.id);
      if (i >= 0 && JSON.stringify(c.msgs[i]) !== JSON.stringify(u)) { c.msgs[i] = u; changed = true; }
    }
    const fresh = messages.filter((m) => !c.msgs.some((x) => x.id === m.id));
    c.msgs.push(...fresh);
    if (changed && S.tab === "chat") updateChatList();
    if (fresh.length) markChatRead();
  } catch { /* 잠시 연결이 끊겨도 다음 번에 다시 */ } finally { chatPolling = false; }
}
// ── 실시간 연결 (웹소켓) ──
// 대화 탭을 보고 있을 때만 연결한다. 서버가 "changed" 신호를 보내면 바로 바뀐 내용을 가져온다.
// 연결이 안 되면 2초마다, 연결돼 있으면 20초마다 안전 확인.
let chatSocket = null;
let chatRetry = null;
let chatRetryDelay = 2000;
let lastChatPoll = 0;
const chatWanted = () => S.token && S.loaded && !personal() && S.tab === "chat" && document.visibilityState === "visible";
const chatLive = () => chatSocket?.readyState === WebSocket.OPEN;

function syncChatSocket() {
  if (!chatWanted()) {
    clearTimeout(chatRetry);
    if (chatSocket) { chatSocket.onclose = null; chatSocket.close(); chatSocket = null; }
    return;
  }
  if (chatSocket && chatSocket.readyState <= WebSocket.OPEN) return; // 연결 중이거나 연결됨
  const proto = location.protocol === "https:" ? "wss" : "ws";
  try {
    chatSocket = new WebSocket(`${proto}://${location.host}/api/chat/ws?token=${encodeURIComponent(S.token)}`);
  } catch { chatSocket = null; return; }
  chatSocket.onopen = () => { chatRetryDelay = 2000; pollChat(); };
  chatSocket.onmessage = (ev) => { if (ev.data === "changed") pollChat(); };
  chatSocket.onerror = () => {};
  chatSocket.onclose = () => {
    chatSocket = null;
    clearTimeout(chatRetry);
    chatRetry = setTimeout(syncChatSocket, chatRetryDelay); // 끊기면 다시 연결 (점점 간격을 늘려 최대 30초)
    chatRetryDelay = Math.min(chatRetryDelay * 2, 30000);
  };
}

setInterval(() => {
  if (!chatWanted()) return;
  syncChatSocket();
  if (Date.now() - lastChatPoll >= (chatLive() ? 20000 : 2000)) pollChat();
}, 1000);
// 연결이 오래 조용하면 중간에서 끊길 수 있어 30초마다 신호
setInterval(() => { if (chatLive()) chatSocket.send("ping"); }, 30000);

// 한글 등 글자 조합 중인지 (조합 중에 보내면 마지막 글자가 빠지거나, 보낸 뒤 입력칸에 글이 되살아날 수 있음)
let chatComposing = false;
let chatSending = false;
let lastSent = { text: "", at: 0 };
document.addEventListener("compositionstart", (ev) => { if (ev.target.form?.id === "chat-form") chatComposing = true; });
document.addEventListener("compositionend", (ev) => { if (ev.target.form?.id === "chat-form") chatComposing = false; });
const waitComposition = () => new Promise((resolve) => {
  if (!chatComposing) { resolve(); return; }
  const until = Date.now() + 400;
  const tick = () => (!chatComposing || Date.now() > until ? resolve() : setTimeout(tick, 20));
  tick();
});

// 보낸 직후 키보드가 조합을 끝내며 보낸 글(또는 끝부분)을 다시 넣으면 지운다
function clearResurrected(t) {
  if (Date.now() - lastSent.at > 1500 || !t.value) return false;
  const v = t.value.trim();
  if (v && (v === lastSent.text || lastSent.text.endsWith(v))) {
    t.value = "";
    S.chatDraft = "";
    autoGrow(t);
    return true;
  }
  return false;
}

async function sendChat(form) {
  if (chatSending) return;
  const t = form.body;
  if (chatComposing) { t.blur(); await waitComposition(); } // 조합을 끝내고 완성된 글자를 읽는다
  const text = t.value.trim();
  if (!text) return;
  chatSending = true;
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  // 서버에 보내기 전에 먼저 비운다 (실패하면 되돌림)
  lastSent = { text, at: Date.now() };
  t.value = "";
  S.chatDraft = "";
  autoGrow(t);
  try {
    const { message } = await api("/chat", { method: "POST", body: { body: text } });
    if (!S.chat.msgs.some((m) => m.id === message.id)) S.chat.msgs.push(message);
    updateChatList({ toBottom: true });
  } catch (e) {
    if (!t.value) { t.value = text; S.chatDraft = text; autoGrow(t); }
    lastSent = { text: "", at: 0 };
    toast(e.message);
  } finally {
    chatSending = false;
    btn.disabled = false;
    t.focus();
    lastSent.at = Date.now();
    setTimeout(() => clearResurrected(t), 50);
    setTimeout(() => clearResurrected(t), 300);
  }
}

function openChatMessage(id) {
  const m = S.chat.msgs.find((x) => x.id === id);
  if (!m || m.deleted) return;
  const mine = m.member_id === S.me.id;
  const who = Object.entries(m.reactions || {}).filter(([, ids]) => ids.length)
    .map(([emoji, ids]) => `<li>${emoji} ${ids.map((i) => esc(nameOf(i) || "?")).join(", ")}</li>`).join("");
  openSheet(`
    <h3>${m.kind === "done" ? "읽기 완료 소식" : m.kind === "join" ? "새 모임원 소식" : mine ? "내 메시지" : `${esc(m.name)}님의 메시지`}</h3>
    <p class="muted" style="margin:0 0 14px;white-space:pre-wrap">${m.kind === "done" ? `${esc(m.name)}님이 오늘 말씀을 다 읽었어요 🎉` : esc(m.body.length > 120 ? m.body.slice(0, 120) + "…" : m.body)}</p>
    <div class="rx-big">${REACTIONS.map((e) => `<button class="${(m.reactions?.[e] || []).includes(S.me.id) ? "on" : ""}" data-action="chat-react" data-id="${m.id}" data-emoji="${e}" aria-label="${e} 공감">${e}</button>`).join("")}</div>
    ${who ? `<h2 class="section">공감한 사람</h2><ul class="plain rx-who">${who}</ul>` : ""}
    ${mine && m.kind === "text" ? `<button class="btn danger block mt" data-action="chat-delete" data-id="${m.id}">메시지 지우기</button>` : ""}`);
}

async function reactChat(id, emoji) {
  const m = S.chat.msgs.find((x) => x.id === id);
  if (!m) return;
  try {
    const { on } = await api(`/chat/${id}/react`, { method: "POST", body: { emoji } });
    const ids = new Set(m.reactions?.[emoji] || []);
    on ? ids.add(S.me.id) : ids.delete(S.me.id);
    m.reactions = { ...m.reactions, [emoji]: [...ids] };
    closeSheet();
    updateChatList();
  } catch (e) { toast(e.message); }
}

async function deleteChat(id) {
  if (!confirm("이 메시지를 지울까요? 모두의 화면에서 '삭제된 메시지예요'로 바뀌어요.")) return;
  try {
    await api(`/chat/${id}`, { method: "DELETE" });
    const m = S.chat.msgs.find((x) => x.id === id);
    if (m) { m.deleted = true; m.body = ""; m.reactions = {}; }
    closeSheet();
    updateChatList();
  } catch (e) { toast(e.message); }
}

// ── 화면: 전체 일정 ───────────────────────────────────
function renderPlan() {
  const t = todayDay();
  const doneCount = S.plan.filter((d) => dayDone(d.day)).length;
  $("#app").innerHTML = `
    <header class="top"><h1>전체 일정</h1><span class="date">${doneCount} / ${total()}일 완료</span></header>
    <div class="btn-row" style="margin-top:0">
      ${t >= 1 && t <= total() ? `<button class="btn secondary" data-action="jump-today">오늘로 이동</button>` : ""}
      ${fixedPlan() ? "" : `<button class="btn secondary" data-action="bulk-edit">전체 표 직접 편집</button>
      <button class="btn secondary" data-action="history">변경 기록</button>`}
    </div>
    <p class="hint">${fixedPlan()
      ? "날짜를 누르면 그날 본문을 체크할 수 있어요. 맥체인 읽기표는 바꿀 수 없어요."
      : `날짜를 누르면 체크하거나 읽기 범위를 바꿀 수 있어요. ${forAll("바꾼 내용은 모두에게 적용돼요.")}`}</p>
    <div class="card mt"><ul class="list">${S.plan.map((d) => dayRowHtml(d.day)).join("")}</ul></div>
    ${navHtml()}`;
}

// ── 화면: 설정 ────────────────────────────────────────
function timePick(slot, value) {
  const [h, m] = value.split(":");
  const hours = Array.from({ length: 24 }, (_, i) => pad2(i));
  const mins = Array.from({ length: 12 }, (_, i) => pad2(i * 5));
  return `<span class="time-pick">
    <select data-action="time" data-slot="${slot}" data-part="h" aria-label="시">${hours.map((x) => `<option ${x === h ? "selected" : ""}>${x}</option>`).join("")}</select>:
    <select data-action="time" data-slot="${slot}" data-part="m" aria-label="분">${mins.map((x) => `<option ${x === m ? "selected" : ""}>${x}</option>`).join("")}</select></span>`;
}

function renderSettings() {
  const me = S.me;
  const slots = [
    ["morning", "아침", "오늘 읽을 말씀 알림"],
    ["lunch", "점심", "아직 다 못 읽었으면 한 번 더"],
    ["evening", "저녁", "하루 마무리 전 마지막 알림"],
  ];
  const pushState = {
    on: `<span class="chip">켜짐</span>`, off: `<span class="chip gold">꺼짐</span>`,
    denied: `<span class="chip warn">차단됨</span>`, "need-install": `<span class="chip gold">홈 화면 추가 필요</span>`,
    unsupported: `<span class="chip warn">지원 안 됨</span>`, unknown: "",
  }[S.push];
  $("#app").innerHTML = `
    <header class="top"><h1>설정</h1><span class="date">${esc(me.name)}님</span></header>

    <h2 class="section">알림</h2>
    <div class="card">
      <div class="setting-row"><div class="main">이 기기 알림 ${pushState}</div>
        ${S.push === "on" ? `<button class="btn ghost" data-action="push-test">테스트</button><button class="btn ghost" data-action="push-off">끄기</button>`
          : S.push === "off" ? `<button class="btn" data-action="push-on">알림 켜기</button>`
          : S.push === "need-install" ? `<button class="btn secondary" data-action="install-guide">방법 보기</button>` : ""}
      </div>
      ${slots.map(([slot, name, desc]) => `
        <div class="setting-row slot">
          <label class="switch"><input type="checkbox" data-action="slot-on" data-slot="${slot}" ${me[`${slot}_on`] ? "checked" : ""} aria-label="${name} 알림"><i></i></label>
          <div class="main">${name}<small>${desc}</small></div>
          ${timePick(slot, me[slot])}
        </div>`).join("")}
      ${personal() ? "" : `<div class="setting-row slot">
          <label class="switch"><input type="checkbox" data-action="chat-push" ${me.chat_push !== false ? "checked" : ""} aria-label="대화 알림"><i></i></label>
          <div class="main">대화<small>새 메시지가 오면 알림 (읽기 완료 소식은 알림 없음)</small></div>
        </div>`}
      <p class="hint">점심·저녁 알림은 그날 분량을 다 체크하지 않았을 때만 와요.</p>
    </div>

    <h2 class="section">읽기 계획</h2>
    <div class="card">
      <p style="margin:0 0 4px"><b>${personal() ? esc(ROADMAPS[S.roadmap]?.name || "") : "397일 성경읽기 로드맵"}</b></p>
      <p class="muted" style="margin:0 0 4px">${fixedPlan() ? `${ROADMAPS[S.roadmap].summary} · ${niceDate(S.startDate, true)} 시작`
        : `${personal() ? `하루 ${S.perDay}장 · ` : "모두 함께 · "}${total()}일`}</p>
      ${fixedPlan() ? "" : `
      <div class="setting-row"><div class="main">${personal() ? "시작일" : "모임 시작일"} <b>${S.startDate ? niceDate(S.startDate, true) : "아직 안 정했어요"}</b>
          ${S.startDate ? `<small>마지막 날 ${niceDate(dateOf(total()), true)}</small>` : ""}</div>
        <button class="btn secondary" data-action="start-date">${S.startDate ? "시작일 바꾸기" : "시작일 정하기"}</button></div>
      ${S.startDate ? `<div class="setting-row"><div class="main">읽는 요일 <b>${weekdaysText(S.readDays)}</b>
          <small>${forAll("모두에게 같이 적용돼요")}</small></div>
        <button class="btn secondary" data-action="read-days">요일 바꾸기</button></div>` : ""}`}
      ${personal() ? `<button class="btn secondary block mt" data-action="plan-change">계획 바꾸기</button>`
        : `<button class="btn secondary block mt" data-action="tab" data-tab="plan">전체 일정 보기 · 범위 바꾸기</button>`}
    </div>

    ${personal() ? `<h2 class="section">주변에 알리기</h2>
    <div class="card">
      <p style="margin:0 0 12px">함께 성경을 읽고 싶은 분께 이 앱을 알려 주세요. 카카오톡·문자로 링크를 보낼 수 있어요.</p>
      <button class="btn block" data-action="share-app">앱 공유하기</button>
    </div>` : ""}

    <h2 class="section">도움말</h2>
    <div class="card">
      <button class="btn ${isStandalone() ? "secondary" : ""} block" data-action="install-guide">홈 화면에 앱 추가하는 방법</button>
      ${isStandalone() ? `<p class="hint">지금 홈 화면 앱으로 쓰고 있어요 👍</p>` : ""}
    </div>

    <h2 class="section">내 정보</h2>
    <div class="card">
      <div class="setting-row"><div class="main">이름 <b>${esc(me.name)}</b></div>
        <button class="btn secondary" data-action="edit-me">내 정보 수정</button></div>
    </div>

    ${personal() ? `<h2 class="section">복구 코드</h2>
    <div class="card">
      <p style="margin:0 0 12px">폰을 바꿨을 때 기록을 이어 쓰는 코드예요.</p>
      <button class="btn secondary block" data-action="show-code">내 복구 코드 보기</button>
    </div>` : ""}

    <div class="card mt">
      <button class="row notices-row" data-action="notices"><span class="main"><span class="title">업데이트 내용</span>
        <span class="sub">새로 바뀐 점을 날짜별로 볼 수 있어요</span></span>
        ${unseenNotices() ? `<span class="chip warn">새 소식 ${unseenNotices()}</span>` : `<span class="mark">›</span>`}</button>
    </div>

    <button class="btn ghost block mt" data-action="sign-out">이 기기에서 나가기</button>
    ${personal() ? `<p class="center"><button class="admin-link" data-action="${hasAdmin() ? "admin-logout" : "admin-open"}">${hasAdmin() ? "관리자 코드 지우기" : "관리자"}</button></p>` : ""}
    ${navHtml()}`;
}

// 시작일(DAY 1) 칸 — 개인 모드는 '읽기 계획' 박스 안, 모임 모드는 따로
function openStartDate() {
  openSheet(`
    <h3>${personal() ? "시작일 (DAY 1)" : "모임 시작일 (DAY 1)"}</h3>
    <form id="start-form">
      <label class="field"><span>${personal() ? "바꾸면 날짜별 읽을 곳이 함께 바뀌어요" : "모든 사람에게 같이 적용돼요"}</span>
        <input class="input" type="date" name="start" value="${esc(S.startDate || kstToday())}" required></label>
      ${S.startDate ? `<p class="hint">현재: ${niceDate(S.startDate, true)} · 마지막 날 ${niceDate(dateOf(total()), true)}</p>` : ""}
      <div class="btn-row"><button class="btn secondary" type="button" data-action="close-sheet">취소</button>
        <button class="btn grow" type="submit">저장${forAll(" (모두에게 적용)")}</button></div>
    </form>`);
}

// 내 정보 수정 창 (이름)
function openEditMe() {
  openSheet(`
    <h3>내 정보 수정</h3>
    <form id="name-form">
      <label class="field"><span>이름</span><input class="input" name="name" value="${esc(S.me.name)}" maxlength="20" required autocomplete="name"></label>
      <div class="btn-row"><button class="btn secondary" type="button" data-action="close-sheet">취소</button>
        <button class="btn grow" type="submit">저장</button></div>
    </form>`);
}

// 업데이트 소식 (개인용 사용자·관리자 앱 공용). 열면 모두 확인한 것으로
// list: 개인용(NOTICES) 또는 모임용(GROUP_NOTICES) 소식
function noticesHtml(seen, list = noticesFor(personal())) {
  return `<h3>업데이트 내용</h3>
    ${list.map((n) => `<div class="notice-item">
      <p class="notice-date">${esc(n.date)}${n.id > seen ? ` <span class="chip warn">NEW</span>` : ""}</p>
      <p class="notice-title">${esc(n.title)}</p>
      <ul class="notice-list">${n.items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    </div>`).join("")}`;
}

function openNotices() {
  const latest = latestNotice(personal());
  openSheet(noticesHtml(S.noticeSeen));
  if (S.noticeSeen >= latest) return;
  S.noticeSeen = latest;
  api("/notices/seen", { method: "POST", body: { id: latest } }).catch(() => {});
  const scroll = window.scrollY;
  render(); // 설정 탭 빨간 점 없애기 (창은 그대로)
  window.scrollTo(0, scroll);
}

// 설정의 '요일 바꾸기' 창
function readDaysPreviewEnd(mask) {
  // 서버와 같은 방식: 오늘부터 새 요일 (시작 전이면 시작일부터)
  const cur = Array.isArray(S.sched) ? S.sched : [{ date: S.startDate, day: 1, mask: S.readDays }];
  const sched = S.today > S.startDate
    ? [...cur.filter((x) => x.date < S.today), { date: S.today, day: dayOnDate(cur, S.today).day, mask }]
    : [{ date: S.startDate, day: 1, mask }];
  return dateOfDaySched(sched, total());
}

function openReadDays(keepDraft = false) {
  if (!keepDraft) S.wdDraft = S.readDays;
  const m = S.wdDraft;
  openSheet(`
    <h3>읽는 요일 바꾸기</h3>
    <p class="muted" style="margin:0 0 12px">${personal() ? "생활에 맞게 " : "모임이 함께 읽을 요일을 "}${MIN_READ_DAYS}일 이상 골라 주세요. 쉬는 요일에는 알림이 오지 않고, 밀린 날로 세지 않아요.${forAll(" <b>모든 사람에게 같이 적용돼요.</b>")}</p>
    ${weekdayChips(m, "wd-toggle")}
    ${validMask(m) ? `<div class="pick-summary"><p><b>${weekdaysText(m)}</b> 읽기</p>
      <p class="muted">마지막 날: ${niceDate(dateOf(total()), true)} → <b>${niceDate(readDaysPreviewEnd(m), true)}</b></p></div>` : ""}
    <p class="hint">오늘부터 적용돼요. 지난 날의 체크 기록은 그대로예요.</p>
    <div class="btn-row"><button class="btn secondary" data-action="close-sheet">취소</button>
      <button class="btn grow" data-action="read-days-save" ${validMask(m) && m !== S.readDays ? "" : "disabled"}>저장</button></div>`);
}

async function saveReadDays(btn) {
  if (!personal() && !confirm(`읽는 요일을 ${weekdaysText(S.wdDraft)}(으)로 바꿀까요? 모든 사람에게 같이 적용돼요.`)) return;
  btn.disabled = true;
  try {
    await api("/read-days", { method: "PUT", body: { mask: S.wdDraft } });
    await loadState();
    closeSheet();
    render();
    toast(`이제 ${S.readDays === EVERY_DAY ? "매일" : `${weekdaysText(S.readDays)}에`} 읽어요. 마지막 날 ${niceDate(dateOf(total()))}`);
  } catch (e) { toast(e.message); btn.disabled = false; }
}

// ── 아래에서 올라오는 창 ──────────────────────────────
function openSheet(html) {
  $("#sheet-root").innerHTML = `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>
    <button class="btn ghost close" data-action="close-sheet" aria-label="닫기">✕</button>${html}</div>`;
}
const closeSheet = () => { $("#sheet-root").innerHTML = ""; };
const sheetOpen = () => !!$("#sheet-root .sheet");

let openDayNo = null;
function openDay(day) {
  openDayNo = day;
  const d = dayPlan(day);
  const date = S.startDate ? niceDate(dateOf(day), true) : "시작일 미정";
  if (fixedPlan()) {
    openSheet(`
      <h3>${S.startDate ? monthDay(dateOf(day)) : ""} 본문</h3>
      <p class="muted" style="margin:0 0 14px">${date} · ${esc(partLabel(d.chapters))}</p>
      <div id="day-checks">${checksHtml(day)}</div>
      ${videoButton(S.startDate ? dateOf(day) : null)}`);
    return;
  }
  openSheet(`
    <h3>DAY ${day}</h3>
    <p class="muted" style="margin:0 0 14px">${date} · ${esc(partLabel(d.chapters))}</p>
    <div id="day-checks">${checksHtml(day)}</div>
    <h2 class="section">읽기 범위 바꾸기</h2>
    <form id="day-form">
      <input class="input" name="text" value="${esc(formatChapters(d.chapters))}" autocomplete="off">
      <p class="hint" id="day-preview">예: 사도행전 28장 · 로마서 1–2장  (쉬는 날은 "쉬는 날")</p>
      <button class="btn block mt" type="submit">범위 저장${forAll(" (모두에게 적용)")}</button>
    </form>`);
}

function previewDay(input) {
  const out = $("#day-preview");
  const r = parseChapters(input.value);
  if (r.error) { out.className = "hint error"; out.textContent = r.error; return; }
  out.className = "hint ok";
  out.textContent = r.chapters.length ? `체크박스 ${r.chapters.length}개: ${formatChapters(r.chapters)}` : "쉬는 날 (체크박스 없음)";
}

async function saveDay(form) {
  const day = openDayNo;
  const r = parseChapters(form.text.value);
  if (r.error) { toast(r.error); return; }
  const before = formatChapters(dayPlan(day).chapters);
  const after = formatChapters(r.chapters);
  if (before === after) { toast("바뀐 내용이 없어요."); return; }
  if (!confirm(`DAY ${day} 범위를 바꿀까요?${forAll(" 모든 사람에게 적용돼요.")}\n\n${before}\n→ ${after}`)) return;
  try {
    const res = await api(`/plan/day/${day}`, { method: "PUT", body: { text: form.text.value } });
    if (res.chapters) dayPlan(day).chapters = res.chapters;
    render();
    openDay(day);
    toast("범위를 바꿨어요.");
  } catch (e) { toast(e.message); }
}

function openBulkEdit() {
  const text = S.plan.map((d) => `DAY ${d.day}: ${formatChapters(d.chapters)}`).join("\n");
  openSheet(`
    <h3>전체 표 직접 편집</h3>
    <p class="hint" style="margin-bottom:10px">한 줄에 하루씩 적어요. 줄을 더하면 날이 늘고, 지우면 줄어요. DAY 번호는 1부터 차례대로 적어 주세요. 저장하면 ${forAll("모두에게 적용되고, ")}변경 기록에서 되돌릴 수 있어요.</p>
    <form id="bulk-form">
      <textarea class="input" name="text" spellcheck="false">${esc(text)}</textarea>
      <button class="btn block mt" type="submit">전체 저장${forAll(" (모두에게 적용)")}</button>
    </form>`);
}

async function saveBulk(form) {
  if (!confirm(`전체 읽기표를 저장할까요?${forAll(" 모든 사람에게 적용돼요.")}`)) return;
  try {
    const res = await api("/plan/bulk", { method: "PUT", body: { text: form.text.value } });
    if (res.unchanged) { toast("바뀐 내용이 없어요."); return; }
    await loadState();
    closeSheet();
    render();
    toast(`저장했어요. 이제 ${res.days}일 일정이에요.`);
  } catch (e) { toast(e.message); }
}

async function openHistory() {
  openSheet(`<h3>변경 기록</h3><p class="empty">불러오는 중…</p>`);
  try {
    const { history: list } = await api("/history");
    if (!sheetOpen()) return;
    openSheet(`<h3>변경 기록</h3>
      <p class="hint" style="margin-bottom:8px">잘못 바뀐 내용은 "되돌리기"로 바꾸기 전 상태로 돌릴 수 있어요.</p>
      ${list.length ? `<ul class="list">${list.map((h) => `<li class="row" style="align-items:flex-start">
        <span class="main"><span class="title">${esc(h.summary)}</span>
        <span class="sub">#${h.id} · ${esc(h.memberName)} · ${new Date(h.createdAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" })}${h.note ? ` · ${esc(h.note)}` : ""}</span></span>
        <button class="btn ghost" data-action="revert" data-id="${h.id}">되돌리기</button></li>`).join("")}</ul>`
        : `<p class="empty">아직 바뀐 내용이 없어요.</p>`}`);
  } catch (e) { toast(e.message); }
}

async function revert(id) {
  if (!confirm(`#${id} 변경을 되돌릴까요?${forAll(" 모든 사람에게 적용돼요.")}`)) return;
  try {
    await api(`/history/${id}/revert`, { method: "POST" });
    await loadState();
    render();
    await openHistory();
    toast("되돌렸어요.");
  } catch (e) { toast(e.message); }
}

// ── 앱 공유 (개인용) ──────────────────────────────────
// 폰의 공유 창(카카오톡·문자 등)을 띄우고, 안 되는 브라우저는 링크를 복사한다
async function shareApp() {
  const url = `${location.origin}/`;
  const text = "말씀 읽고 새 인생 (개인용) — 나에게 맞는 순서와 분량으로 성경 전체를 읽어요. 매일 읽을 곳을 알려 주고 장마다 체크해요. 함께 읽어요!";
  if (navigator.share) {
    try { await navigator.share({ title: appName(), text, url }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(`${text}\n${url}`);
    toast("링크를 복사했어요. 카카오톡이나 문자에 붙여 넣어 주세요.");
  } catch {
    openSheet(`<h3>앱 공유하기</h3><p class="muted">아래 주소를 길게 눌러 복사해 주세요.</p><p class="passage" style="word-break:break-all">${esc(url)}</p>`);
  }
}

// ── 앱 설치 안내 ──────────────────────────────────────
// 홈 화면 앱이 아니라 브라우저로 열면 열 때마다 설치 방법 창을 띄운다 (닫기만 있고 '그만 보기'는 없음)
let installEvent = null; // 갤럭시 크롬·삼성 인터넷: 바로 설치 창을 띄울 수 있을 때 받는 이벤트
window.addEventListener("beforeinstallprompt", (ev) => {
  ev.preventDefault();
  installEvent = ev;
  if ($("#install-guide")) openInstallGuide(); // 열려 있는 안내에 [지금 앱 설치] 버튼 추가
});
window.addEventListener("appinstalled", () => {
  installEvent = null;
  if ($("#install-guide")) closeSheet();
  toast("설치됐어요. 홈 화면의 앱으로 열어 주세요.");
});

// 카카오톡·네이버 등 앱 안의 브라우저 (여기서는 홈 화면 추가가 안 됨)
const inAppBrowser = () => /KAKAOTALK|NAVER\(|Instagram|FBAN|FBAV|Line\/|DaumApps|everytimeApp/i.test(navigator.userAgent);

let lastInstallPopup = 0;
function autoInstallGuide() {
  if (isStandalone() || sheetOpen() || Date.now() - lastInstallPopup < 10 * 60000) return;
  lastInstallPopup = Date.now();
  openInstallGuide();
}

async function installNow() {
  if (!installEvent) { toast("브라우저 메뉴에서 '홈 화면에 추가' 또는 '앱 설치'를 눌러 주세요."); return; }
  installEvent.prompt();
  const { outcome } = await installEvent.userChoice.catch(() => ({}));
  if (outcome === "accepted") installEvent = null;
}

function openInstallGuide() {
  const share = `<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>`;
  const iphone = `<h2 class="section">아이폰 (iOS 16.4 이상)</h2>
    <ol class="steps">
      <li><b>사파리(Safari)</b>로 이 주소를 엽니다.</li>
      <li>아래쪽 공유 버튼 ${share} 을 누릅니다.</li>
      <li><b>홈 화면에 추가</b>를 누르고, 오른쪽 위 <b>추가</b>를 누릅니다.</li>
      <li>홈 화면에 생긴 <b>${homeName()}</b> 아이콘으로 들어가 입장한 뒤 <b>알림 켜기</b>를 누릅니다.</li>
    </ol>`;
  const galaxy = `<h2 class="section">갤럭시</h2>
    <ol class="steps">
      <li><b>크롬</b> 또는 <b>삼성 인터넷</b>으로 이 주소를 엽니다.</li>
      <li>메뉴(⋮ 또는 ≡)에서 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누릅니다.</li>
      <li>앱으로 들어가 <b>알림 켜기</b>를 누르고 <b>허용</b>합니다.</li>
    </ol>`;
  const inApp = inAppBrowser()
    ? `<div class="notice warn"><p>지금은 카카오톡 같은 앱 안에서 열려 있어요. 오른쪽 위 메뉴에서 <b>${isIOS() ? "Safari로 열기" : "다른 브라우저로 열기(크롬·삼성 인터넷)"}</b>를 누른 뒤 아래 순서대로 해 주세요.</p></div>`
    : "";
  openSheet(`<div id="install-guide">
    <h3>홈 화면에 앱 추가하기</h3>
    <p class="muted" style="margin:0 0 12px">홈 화면에 추가하면 앱처럼 바로 열리고, 매일 읽을 곳을 알림으로 받을 수 있어요.</p>
    ${inApp}
    ${installEvent ? `<button class="btn block" data-action="install-now">지금 앱 설치</button>` : ""}
    ${isIOS() ? iphone + galaxy : galaxy + iphone}
    <button class="btn secondary block mt" data-action="close-sheet">닫기</button>
  </div>`);
}

// ── 렌더링 ────────────────────────────────────────────
function render() {
  if (!S.token) { renderJoin(); return; }
  if (!S.loaded) { $("#app").innerHTML = `<div class="splash">${brandHtml()}</div>`; return; }
  if (personal() && GROUP_ONLY_TABS.includes(S.tab)) S.tab = "today";
  if (S.tab === "admin" && !hasAdmin()) S.tab = "settings";
  $("#app").classList.toggle("chat-mode", S.tab === "chat");
  ({ today: renderToday, together: renderTogether, chat: renderChat, plan: renderPlan, settings: renderSettings, admin: renderAdmin }[S.tab] || renderToday)();
  const nav = $("nav.tabs");
  if (nav) document.documentElement.style.setProperty("--nav-h", `${nav.offsetHeight}px`);
  syncChatSocket();
}

// ── 이벤트 ────────────────────────────────────────────
async function toggleCheck(btn) {
  const day = Number(btn.dataset.day);
  const key = btn.dataset.key;
  if (!S.checks.has(day)) S.checks.set(day, new Set());
  const set = S.checks.get(day);
  const checked = !set.has(key);
  checked ? set.add(key) : set.delete(key);
  const nowDone = checked && dayDone(day);
  rerenderKeepingSheet(day);
  if (nowDone) celebrateDay(day);
  try {
    await api("/check", { method: "POST", body: { day, chapter: key, checked } });
  } catch (e) {
    checked ? set.delete(key) : set.add(key);
    rerenderKeepingSheet(day);
    toast(e.message);
  }
}

// 하루 분량을 다 체크했을 때 축하: 1독 완주 > PART(구간) 완독 > 오늘 완료 > 지난 날 완료
function celebrateDay(day) {
  if (S.plan.every((d) => dayDone(d.day))) {
    celebrate("big");
    toast("🎉 성경 1독 완주! 정말 수고하셨어요");
    return;
  }
  const label = partLabel(dayPlan(day).chapters);
  if (!fixedPlan() && label) {
    const sectionDays = S.plan.filter((d) => partLabel(d.chapters) === label);
    if (sectionDays.every((d) => dayDone(d.day))) {
      celebrate("big");
      toast(`🏅 ${label} 완독!`);
      return;
    }
  }
  if (day === todayDay()) {
    const s = streak();
    celebrate("normal");
    toast(s >= 2 ? `오늘 말씀 완료! 🔥 ${s}일 연속` : "오늘 말씀 완료! 🎉");
  } else {
    celebrate("small");
    toast(`DAY ${day} 완료!`);
  }
}

function rerenderKeepingSheet(day) {
  const scroll = window.scrollY;
  render();
  window.scrollTo(0, scroll);
  if (sheetOpen() && openDayNo === day && $("#day-checks")) $("#day-checks").innerHTML = checksHtml(day);
}

async function saveMe(patch) {
  try {
    const res = await api("/me", { method: "PUT", body: patch });
    S.me = res.me;
    render();
    toast("저장했어요.");
    return true;
  } catch (e) { toast(e.message); render(); return false; }
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT" || el.type === "checkbox") return;
  const a = el.dataset.action;
  if (a === "toggle") toggleCheck(el);
  else if (a === "tab") {
    S.tab = el.dataset.tab;
    store.set("tab", S.tab);
    window.scrollTo(0, 0);
    render();
    if (S.tab === "together") loadMembers();
    if (S.tab === "admin") loadAdmin();
  } else if (a === "toggle-missed") { S.showAllMissed = !S.showAllMissed; render(); }
  else if (a === "open-day") openDay(Number(el.dataset.day));
  else if (a === "close-sheet") closeSheet();
  else if (a === "jump-today") $(`#day-${todayDay()}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  else if (a === "bulk-edit") openBulkEdit();
  else if (a === "history") openHistory();
  else if (a === "revert") revert(Number(el.dataset.id));
  else if (a === "push-on") enablePush();
  else if (a === "push-off") disablePush();
  else if (a === "push-test") {
    try { await api("/push/test", { method: "POST" }); toast("테스트 알림을 보냈어요."); } catch (e) { toast(e.message); }
  } else if (a === "install-guide") openInstallGuide();
  else if (a === "join-view") { S.joinView = el.dataset.view; render(); }
  else if (a === "pick-roadmap") {
    S.pick.roadmap = el.dataset.id;
    pickGo(1);
  } else if (a === "pick-perday") { S.pick.perDay = Number(el.dataset.n); rerenderPicker(); }
  else if (a === "pick-next") pickGo(1);
  else if (a === "pick-back") pickGo(-1);
  else if (a === "pick-submit") submitPick(el);
  else if (a === "plan-change") openPlanChange();
  else if (a === "pick-wd") { S.pick.readDays ^= 1 << Number(el.dataset.i); rerenderPicker(); }
  else if (a === "read-days") openReadDays();
  else if (a === "start-date") openStartDate();
  else if (a === "wd-toggle") { S.wdDraft ^= 1 << Number(el.dataset.i); openReadDays(true); }
  else if (a === "read-days-save") saveReadDays(el);
  else if (a === "edit-me") openEditMe();
  else if (a === "notices") openNotices();
  else if (a === "admin-notices") {
    openSheet(noticesHtml(Number(store.get("adminNoticeSeen") || 0), NOTICES));
    store.set("adminNoticeSeen", String(LATEST_NOTICE));
    $("#admin-notice-new")?.remove();
  }
  else if (a === "install-now") installNow();
  else if (a === "share-app") shareApp();
  else if (a === "member") openMember(Number(el.dataset.id));
  else if (a === "chat-msg") openChatMessage(Number(el.dataset.id));
  else if (a === "chat-react") reactChat(Number(el.dataset.id), el.dataset.emoji);
  else if (a === "chat-delete") deleteChat(Number(el.dataset.id));
  else if (a === "chat-older") loadOlderChat();
  else if (a === "admin-open") openAdminLogin();
  else if (a === "admin-refresh") loadAdmin();
  else if (a === "admin-logout") {
    if (!confirm("이 기기에서 관리자 코드를 지울까요? 관리자 탭이 사라져요.")) return;
    store.del("adminCode");
    S.admin = null;
    render();
    toast("관리자 코드를 지웠어요.");
  }
  else if (a === "admin-delete") {
    const code = store.get("adminCode") || "";
    if (!confirm(`#${el.dataset.id} ${el.dataset.name} 계정과 모든 기록을 지울까요? 되돌릴 수 없어요.`)) return;
    try {
      const res = await fetch("/api/admin/delete", { method: "POST", headers: { "Content-Type": "application/json", "X-Admin-Code": encodeURIComponent(code) }, body: JSON.stringify({ id: Number(el.dataset.id) }) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "지우지 못했어요.");
      toast("지웠어요.");
      loadAdmin();
    } catch (e) { toast(e.message); }
  }
  else if (a === "show-code") openRecoveryInfo();
  else if (a === "copy-code") {
    try { await navigator.clipboard.writeText(S.me.recoveryCode); toast("복사했어요."); } catch { toast("길게 눌러 직접 복사해 주세요."); }
  }
  else if (a === "sign-out") {
    const bye = personal()
      ? "이 기기에서 나갈까요? 기록은 남아 있고, 복구 코드가 있어야 다시 이어서 쓸 수 있어요."
      : "이 기기에서 나갈까요? 기록은 남아 있고, 같은 이름으로 다시 입장하면 이어서 쓸 수 있어요.";
    if (confirm(bye)) {
      if (S.push === "on") await disablePush();
      signOut();
    }
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.id === "pick-start" && el.value) { S.pick.start = el.value; rerenderPicker(); return; }
  if (el.dataset.action === "slot-on") saveMe({ [`${el.dataset.slot}_on`]: el.checked });
  if (el.dataset.action === "chat-push") saveMe({ chat_push: el.checked });
  if (el.dataset.action === "time") {
    const slot = el.dataset.slot;
    const h = $(`select[data-slot="${slot}"][data-part="h"]`).value;
    const m = $(`select[data-slot="${slot}"][data-part="m"]`).value;
    saveMe({ [slot]: `${h}:${m}` });
  }
});

document.addEventListener("input", (ev) => {
  if (ev.target.form?.id === "chat-form") {
    if (!clearResurrected(ev.target)) { S.chatDraft = ev.target.value; autoGrow(ev.target); }
  }
  if (ev.target.form?.id === "day-form") previewDay(ev.target);
  if (ev.target.form?.id === "pick-name-form" && S.pick) S.pick.name = ev.target.value;
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.id === "admin-form") submitAdminCode(f);
  else if (f.id === "chat-form") sendChat(f);
  else if (f.id === "join-form") submitJoin(f);
  else if (f.id === "pick-name-form") {
    const name = f.name.value.trim();
    if (!name) { toast("이름을 적어 주세요."); return; }
    S.pick.name = name;
    pickGo(1);
  }
  else if (f.id === "recover-form") submitRecover(f);
  else if (f.id === "day-form") saveDay(f);
  else if (f.id === "bulk-form") saveBulk(f);
  else if (f.id === "name-form") { if (await saveMe({ name: f.name.value })) closeSheet(); }
  else if (f.id === "start-form") {
    const v = f.start.value;
    if (v === S.startDate) { toast("바뀐 내용이 없어요."); return; }
    const question = personal()
      ? `시작일(DAY 1)을 ${niceDate(v, true)}로 바꿀까요? "오늘 읽을 곳"이 바뀌어요.`
      : `모임 시작일(DAY 1)을 ${niceDate(v, true)}로 바꿀까요? 모든 사람의 "오늘 읽을 곳"이 바뀌어요.`;
    if (!confirm(question)) return;
    try {
      await api("/settings", { method: "PUT", body: { start_date: v } });
      await loadState();
      closeSheet();
      render();
      toast("시작일을 저장했어요.");
    } catch (e) { toast(e.message); }
  }
});

// 앱으로 다시 돌아오면 최신 정보로 (날짜가 바뀌었을 수 있음)
document.addEventListener("visibilitychange", () => {
  syncChatSocket();
  if (document.visibilityState === "visible" && S.token && !sheetOpen()) {
    refresh();
    if (S.tab === "together") loadMembers();
  }
  if (document.visibilityState === "visible") autoInstallGuide(); // 브라우저로 다시 열면 설치 안내 (10분 간격)
});

// ── 관리자 탭 (개인 모드, 설정 맨 아래 '관리자'에서 코드를 넣은 기기만) ─────────────
function agoText(iso) {
  if (!iso) return "없음";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  if (min < 60 * 24) return `${Math.round(min / 60)}시간 전`;
  return `${Math.round(min / 60 / 24)}일 전`;
}

// 관리자 통계 불러오기. 코드가 틀리면 null, 연결이 안 되면 오류
async function fetchAdmin(code) {
  let res;
  try {
    res = await fetch("/api/admin/stats", { headers: { "X-Admin-Code": encodeURIComponent(code) } });
  } catch { throw new Error("인터넷 연결을 확인해 주세요."); }
  const data = await res.json().catch(() => ({}));
  if (res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(data.error || "문제가 생겼어요.");
  return data;
}

function openAdminLogin(message = "") {
  openSheet(`
    <h3>관리자</h3>
    <form id="admin-form">
      <label class="field"><span>관리자 코드</span>
        <input class="input" name="code" type="password" autocomplete="off" required></label>
      ${message ? `<p class="hint error">${esc(message)}</p>` : ""}
      <button class="btn block mt" type="submit">확인</button>
      <p class="hint">코드가 맞으면 이 기기에 관리자 탭이 생겨요.</p>
    </form>`);
}

async function submitAdminCode(form) {
  const code = form.code.value.trim();
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const data = await fetchAdmin(code);
    if (!data) { openAdminLogin("관리자 코드가 맞지 않아요."); return; }
    store.set("adminCode", code);
    S.admin = data;
    closeSheet();
    S.tab = "admin";
    store.set("tab", S.tab);
    window.scrollTo(0, 0);
    render();
  } catch (e) { toast(e.message); btn.disabled = false; }
}

async function loadAdmin() {
  const code = store.get("adminCode");
  if (!code) return;
  try {
    const data = await fetchAdmin(code);
    if (!data) { // 코드가 바뀌었거나 지워짐
      store.del("adminCode");
      S.admin = null;
      render();
      toast("관리자 코드가 맞지 않아 관리자 탭을 닫았어요.");
      return;
    }
    S.admin = data;
    if (S.tab === "admin") render();
  } catch (e) { toast(e.message); }
}

function renderAdmin() {
  const head = `<header class="top"><h1>관리자 통계</h1><button class="btn ghost" data-action="admin-refresh">새로 고침</button></header>`;
  if (!S.admin) {
    $("#app").innerHTML = `${head}<p class="empty">불러오는 중…</p>${navHtml()}`;
    return;
  }
  const { summary: sm, users } = S.admin;
  const stat = (n, label) => `<div><b>${n}</b><span>${label}</span></div>`;
  const rowHtml = (u) => `
    <li class="admin-user ${u.test ? "is-test" : ""}">
      <div class="line1"><span class="name">#${u.no} ${esc(u.name)}${u.test ? ` <span class="chip warn">테스트</span>` : ""}</span>
        <span class="chips">${u.appFirstAt ? `<span class="chip">📱 앱</span>` : `<span class="chip gold">🌐 웹만</span>`}${u.push ? ` <span class="chip">🔔</span>` : ""}</span></div>
      <div class="sub">${esc(ROADMAPS[u.roadmap]?.name || u.roadmap)}${isFixed(u.roadmap) ? "" : ` · 하루 ${u.perDay}장`} · 체크 ${u.checked}장</div>
      <div class="sub">가입 ${u.createdAt ? niceDate(kstDateOf(u.createdAt)) : "-"} · 마지막 접속 ${agoText(u.lastSeenAt)}${u.appLastAt ? ` · 앱으로 ${agoText(u.appLastAt)}` : ""}</div>
      <button class="btn ghost admin-del" data-action="admin-delete" data-id="${u.no}" data-name="${esc(u.name)}">삭제</button>
    </li>`;
  const byRecent = (a, b) => (b.lastSeenAt || "").localeCompare(a.lastSeenAt || "");
  const rows = users.filter((u) => !u.test).sort(byRecent).map(rowHtml).join("");
  const testRows = users.filter((u) => u.test).sort(byRecent).map(rowHtml).join("");
  $("#app").innerHTML = `
    ${head}
    <button class="btn secondary block" data-action="admin-notices" style="margin-bottom:14px">개인용 업데이트 내용${Number(store.get("adminNoticeSeen") || 0) < LATEST_NOTICE ? ` <span class="chip warn" id="admin-notice-new">새 소식</span>` : ""}</button>
    <div class="admin-stats">
      ${stat(sm.total, "전체 사용자")}
      ${stat(sm.installed, "앱으로 연 사람")}
      ${stat(sm.installed7, "앱 · 최근 7일")}
      ${stat(sm.active1, "최근 1일 접속")}
      ${stat(sm.active7, "최근 7일 접속")}
      ${stat(sm.push, "알림 켬")}
    </div>
    <p class="mm-months mt">${ROADMAP_ORDER.map((id) => `<span class="chip">${esc(ROADMAPS[id].name)} ${sm.byRoadmap[id] || 0}</span>`).join(" ")}</p>
    <h2 class="section">사용자 <small>최근 접속 순</small></h2>
    <ul class="card list admin-list">${rows || `<p class="empty">아직 없어요.</p>`}</ul>
    ${testRows ? `<h2 class="section">테스트 계정 <small>통계에서 빠짐 · ${sm.tests}개</small></h2><ul class="card list admin-list">${testRows}</ul>` : ""}
    <p class="hint">📱 앱 = 홈 화면에 추가한 앱으로 연 적이 있는 사람 (2026년 10월 2일 업데이트 이후 기록부터). 🌐 웹만 = 아직 앱으로 연 기록이 없는 사람.</p>
    <button class="btn ghost block mt" data-action="admin-logout">이 기기에서 관리자 코드 지우기</button>
    ${navHtml()}`;
}

// ── 시작 ──────────────────────────────────────────────
async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  const params = new URLSearchParams(location.search);
  const invite = params.get("invite");
  if (invite) store.set("invite", invite);
  if (params.get("tab") && TAB_NAMES[params.get("tab")]) {
    S.tab = params.get("tab");
    store.set("tab", S.tab);
    if (!invite) history.replaceState(null, "", "/");
  }
  try {
    const config = await fetch("/api/config").then((r) => r.json());
    if (config.mode) { S.mode = config.mode; store.set("mode", S.mode); }
  } catch { /* 인터넷이 안 되면 마지막으로 알던 모드 사용 */ }
  if (!S.token) { render(); autoInstallGuide(); return; }
  render();
  autoInstallGuide();
  try {
    await loadState();
  } catch (e) {
    toast(e.message);
    if (!S.token) return;
  }
  await detectPush().catch(() => {});
  render();
  if (S.tab === "together") loadMembers();
  if (S.tab === "admin") loadAdmin();
}

start();
