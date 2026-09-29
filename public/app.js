// "말씀 읽고 새 인생" 앱 화면
import {
  chapterKey, dateOfDay, dayIndex, formatChapters, isDayDone, kstToday, parseChapters, partOf, PART_TITLES,
} from "./shared/bible.js";

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
  members: null, showAllMissed: false, push: "unknown",
};

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
      headers: { "Content-Type": "application/json", ...(S.token ? { Authorization: "Bearer " + S.token } : {}) },
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
const todayDay = () => (S.startDate ? dayIndex(S.startDate, S.today) : null);
const dayPlan = (day) => S.plan[day - 1];
const checkedSet = (day) => S.checks.get(day) || new Set();
const dayDone = (day) => isDayDone(dayPlan(day).chapters, checkedSet(day));
function missedDays() {
  const t = todayDay();
  if (!t) return [];
  const out = [];
  for (let d = 1; d < Math.min(t, total() + 1); d++) if (!dayDone(d)) out.push(d);
  return out;
}
const partLabel = (chapters) => {
  const p = partOf(chapters);
  return p ? `${pad2(p)} · ${PART_TITLES[p]}` : "쉬는 날";
};

// ── 데이터 불러오기 ───────────────────────────────────
async function loadState() {
  const data = await api("/state");
  S.me = data.me;
  S.plan = data.plan;
  S.startDate = data.startDate;
  S.today = data.today;
  S.vapid = data.vapidPublicKey;
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
      <span class="box">${CHECK_SVG}</span><span class="label">${esc(c[0])} ${c[1]}장</span></button></li>`;
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
  plan: `<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.2 7.4l2 1.2M17.8 15.4l2 1.2M4.2 16.6l2-1.2M17.8 8.6l2-1.2"/>`,
};
const TAB_NAMES = { today: "오늘", together: "함께", plan: "일정", settings: "설정" };

function navHtml() {
  return `<nav class="tabs" aria-label="메뉴"><div class="inner">${Object.keys(TAB_NAMES).map((t) => `
    <button data-action="tab" data-tab="${t}" ${S.tab === t ? 'aria-current="page"' : ""}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[t]}</svg>
      ${TAB_NAMES[t]}</button>`).join("")}</div></nav>`;
}

// ── 화면: 입장 ────────────────────────────────────────
function renderJoin() {
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

// ── 화면: 오늘 ────────────────────────────────────────
function renderToday() {
  const t = todayDay();
  let main;
  if (!S.startDate) {
    main = `<div class="card"><p>아직 모임의 <b>시작일</b>이 정해지지 않았어요.</p>
      <button class="btn" data-action="tab" data-tab="settings">시작일 정하러 가기</button></div>`;
  } else if (t < 1) {
    main = `<div class="card">
      <div class="today-head"><div class="day-no">D-${1 - t}</div><span class="chip gold">${niceDate(S.startDate)} 시작</span></div>
      <p class="passage">첫날 읽을 말씀: ${esc(formatChapters(dayPlan(1).chapters))}</p>
      <p class="muted">시작일이 되면 매일 아침 읽을 곳을 알려드릴게요.</p></div>`;
  } else if (t > total()) {
    main = `<div class="card"><div class="day-no">완주 🎉</div>
      <p class="passage">${total()}일의 여정이 끝났어요.</p>
      <p class="muted">${missedDays().length ? `아직 밀린 읽기 ${missedDays().length}일이 남아 있어요.` : "성경 전체를 모두 읽으셨어요. 수고하셨어요!"}</p></div>`;
  } else {
    const d = dayPlan(t);
    const done = dayDone(t);
    main = `<div class="card">
      <div class="today-head"><div class="day-no">DAY ${t} <small>/ ${total()}</small></div><span class="chip">${esc(partLabel(d.chapters))}</span></div>
      <p class="passage">${esc(formatChapters(d.chapters))}</p>
      ${checksHtml(t)}
      ${done ? `<p class="done-banner">오늘 말씀 완료! 🙌</p>` : ""}
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
    <header class="top"><h1>말씀 읽고 새 인생</h1><span class="date">${niceDate(S.today)}</span></header>
    ${pushNotice()}
    ${main}
    ${missedHtml}
    ${navHtml()}`;
}

function dayRowHtml(day) {
  const d = dayPlan(day);
  const t = todayDay();
  const done = dayDone(day);
  const set = checkedSet(day);
  const partial = d.chapters.filter((c) => set.has(chapterKey(c))).length;
  const isMissed = !done && t && day < t;
  const mark = done ? "✓" : partial ? `${partial}/${d.chapters.length}` : isMissed ? "•" : "";
  const date = S.startDate ? niceDate(dateOfDay(S.startDate, day)) : "";
  return `<li><button class="row ${day === t ? "is-today" : ""} ${isMissed ? "missed" : ""}" data-action="open-day" data-day="${day}" id="day-${day}">
    <span class="main"><span class="title">DAY ${day} · ${esc(formatChapters(d.chapters))}</span>
    <span class="sub">${date}${day === t ? " · 오늘" : ""}</span></span>
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
    const sorted = [...list].sort((a, b) => a.missedDays - b.missedDays || b.doneDays - a.doneDays || a.name.localeCompare(b.name, "ko"));
    body = sorted.map((m) => {
      const pct = m.total ? Math.round((m.doneDays / m.total) * 100) : 0;
      const today = m.todayTotal ? (m.todayDone ? `<span class="chip">오늘 완료</span>` : `<span class="chip gold">오늘 ${m.todayChecked}/${m.todayTotal}</span>`) : "";
      const missed = m.missedDays ? `<span class="chip warn">밀린 날 ${m.missedDays}일</span>` : `<span class="chip">밀린 날 없음</span>`;
      return `<div class="member">
        <div class="line1"><span class="name">${esc(m.name)}${m.id === S.me.id ? ` <span class="me">(나)</span>` : ""}</span><span>${missed} ${today}</span></div>
        <div class="progress" aria-label="진행률 ${pct}%"><i style="width:${pct}%"></i></div>
        <div class="line2"><span>${m.doneDays} / ${m.total}일 완료</span><span>${pct}%</span></div>
      </div>`;
    }).join("");
  }
  $("#app").innerHTML = `
    <header class="top"><h1>함께 읽기</h1><span class="date">${list ? `${list.length}명` : ""}</span></header>
    <div class="card">${body}</div>
    <p class="hint">밀린 날 = 오늘 이전 날짜 중 아직 다 읽지 못한 날 수</p>
    ${navHtml()}`;
}

// ── 화면: 전체 일정 ───────────────────────────────────
function renderPlan() {
  const t = todayDay();
  const doneCount = S.plan.filter((d) => dayDone(d.day)).length;
  $("#app").innerHTML = `
    <header class="top"><h1>전체 일정</h1><span class="date">${doneCount} / ${total()}일 완료</span></header>
    <div class="btn-row" style="margin-top:0">
      ${t >= 1 && t <= total() ? `<button class="btn secondary" data-action="jump-today">오늘로 이동</button>` : ""}
      <button class="btn secondary" data-action="bulk-edit">전체 표 직접 편집</button>
      <button class="btn secondary" data-action="history">변경 기록</button>
    </div>
    <p class="hint">날짜를 누르면 체크하거나 읽기 범위를 바꿀 수 있어요. 바꾼 내용은 모두에게 적용돼요.</p>
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
      <p class="hint">점심·저녁 알림은 그날 분량을 다 체크하지 않았을 때만 와요.</p>
    </div>

    <h2 class="section">모임 시작일 (DAY 1)</h2>
    <form class="card" id="start-form">
      <label class="field"><span>모든 사람에게 같이 적용돼요</span>
        <input class="input" type="date" name="start" value="${esc(S.startDate || "")}" required></label>
      <button class="btn" type="submit">시작일 저장</button>
      ${S.startDate ? `<p class="hint">현재: ${niceDate(S.startDate, true)} · 마지막 날 ${niceDate(dateOfDay(S.startDate, total()), true)}</p>` : ""}
    </form>

    <h2 class="section">내 정보</h2>
    <form class="card" id="name-form">
      <label class="field"><span>이름</span><input class="input" name="name" value="${esc(me.name)}" maxlength="20" required></label>
      <button class="btn secondary" type="submit">이름 저장</button>
    </form>

    <h2 class="section">도움말</h2>
    <div class="card">
      <button class="btn secondary block" data-action="install-guide">홈 화면에 앱 추가하는 방법</button>
      <button class="btn ghost block mt" data-action="sign-out">이 기기에서 나가기</button>
    </div>
    ${navHtml()}`;
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
  const date = S.startDate ? niceDate(dateOfDay(S.startDate, day), true) : "시작일 미정";
  openSheet(`
    <h3>DAY ${day}</h3>
    <p class="muted" style="margin:0 0 14px">${date} · ${esc(partLabel(d.chapters))}</p>
    <div id="day-checks">${checksHtml(day)}</div>
    <h2 class="section">읽기 범위 바꾸기</h2>
    <form id="day-form">
      <input class="input" name="text" value="${esc(formatChapters(d.chapters))}" autocomplete="off">
      <p class="hint" id="day-preview">예: 사도행전 28장 · 로마서 1–2장  (쉬는 날은 "쉬는 날")</p>
      <button class="btn block mt" type="submit">범위 저장 (모두에게 적용)</button>
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
  if (!confirm(`DAY ${day} 범위를 바꿀까요? 모든 사람에게 적용돼요.\n\n${before}\n→ ${after}`)) return;
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
    <p class="hint" style="margin-bottom:10px">한 줄에 하루씩 적어요. 줄을 더하면 날이 늘고, 지우면 줄어요. DAY 번호는 1부터 차례대로 적어 주세요. 저장하면 모두에게 적용되고, 변경 기록에서 되돌릴 수 있어요.</p>
    <form id="bulk-form">
      <textarea class="input" name="text" spellcheck="false">${esc(text)}</textarea>
      <button class="btn block mt" type="submit">전체 저장 (모두에게 적용)</button>
    </form>`);
}

async function saveBulk(form) {
  if (!confirm("전체 읽기표를 저장할까요? 모든 사람에게 적용돼요.")) return;
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
  if (!confirm(`#${id} 변경을 되돌릴까요? 모든 사람에게 적용돼요.`)) return;
  try {
    await api(`/history/${id}/revert`, { method: "POST" });
    await loadState();
    render();
    await openHistory();
    toast("되돌렸어요.");
  } catch (e) { toast(e.message); }
}

function openInstallGuide() {
  const share = `<svg class="share-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;vertical-align:-3px"><path d="M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7"/></svg>`;
  openSheet(`
    <h3>홈 화면에 앱 추가하기</h3>
    <h2 class="section">아이폰 (iOS 16.4 이상)</h2>
    <ol class="steps">
      <li><b>사파리(Safari)</b>로 이 주소를 엽니다.</li>
      <li>아래쪽 공유 버튼 ${share} 을 누릅니다.</li>
      <li><b>홈 화면에 추가</b>를 누르고, 오른쪽 위 <b>추가</b>를 누릅니다.</li>
      <li>홈 화면에 생긴 <b>말씀 새 인생</b> 아이콘으로 들어가 입장한 뒤 <b>알림 켜기</b>를 누릅니다.</li>
    </ol>
    <h2 class="section">갤럭시</h2>
    <ol class="steps">
      <li><b>크롬</b> 또는 <b>삼성 인터넷</b>으로 이 주소를 엽니다.</li>
      <li>메뉴(⋮ 또는 ≡)에서 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 누릅니다.</li>
      <li>앱으로 들어가 <b>알림 켜기</b>를 누르고 <b>허용</b>합니다.</li>
    </ol>`);
}

// ── 렌더링 ────────────────────────────────────────────
function render() {
  if (!S.token) { renderJoin(); return; }
  if (!S.loaded) { $("#app").innerHTML = `<div class="splash"><h1 class="brand">말씀 읽고<br>새 인생</h1></div>`; return; }
  ({ today: renderToday, together: renderTogether, plan: renderPlan, settings: renderSettings }[S.tab] || renderToday)();
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
  if (nowDone) toast(day === todayDay() ? "오늘 말씀 완료! 🙌" : `DAY ${day} 완료!`);
  try {
    await api("/check", { method: "POST", body: { day, chapter: key, checked } });
  } catch (e) {
    checked ? set.delete(key) : set.add(key);
    rerenderKeepingSheet(day);
    toast(e.message);
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
  } catch (e) { toast(e.message); render(); }
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
  else if (a === "sign-out") {
    if (confirm("이 기기에서 나갈까요? 기록은 남아 있고, 같은 이름으로 다시 입장하면 이어서 쓸 수 있어요.")) {
      if (S.push === "on") await disablePush();
      signOut();
    }
  }
});

document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el.dataset.action === "slot-on") saveMe({ [`${el.dataset.slot}_on`]: el.checked });
  if (el.dataset.action === "time") {
    const slot = el.dataset.slot;
    const h = $(`select[data-slot="${slot}"][data-part="h"]`).value;
    const m = $(`select[data-slot="${slot}"][data-part="m"]`).value;
    saveMe({ [slot]: `${h}:${m}` });
  }
});

document.addEventListener("input", (ev) => {
  if (ev.target.form?.id === "day-form") previewDay(ev.target);
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.id === "join-form") submitJoin(f);
  else if (f.id === "day-form") saveDay(f);
  else if (f.id === "bulk-form") saveBulk(f);
  else if (f.id === "name-form") saveMe({ name: f.name.value });
  else if (f.id === "start-form") {
    const v = f.start.value;
    if (v === S.startDate) { toast("바뀐 내용이 없어요."); return; }
    if (!confirm(`모임 시작일(DAY 1)을 ${niceDate(v, true)}로 바꿀까요? 모든 사람의 "오늘 읽을 곳"이 바뀌어요.`)) return;
    try {
      await api("/settings", { method: "PUT", body: { start_date: v } });
      await loadState();
      render();
      toast("시작일을 저장했어요.");
    } catch (e) { toast(e.message); }
  }
});

// 앱으로 다시 돌아오면 최신 정보로 (날짜가 바뀌었을 수 있음)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.token && !sheetOpen()) {
    refresh();
    if (S.tab === "together") loadMembers();
  }
});

// ── 시작 ──────────────────────────────────────────────
async function start() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  const invite = new URLSearchParams(location.search).get("invite");
  if (invite) store.set("invite", invite);
  if (!S.token) { render(); return; }
  render();
  try {
    await loadState();
  } catch (e) {
    toast(e.message);
    if (!S.token) return;
  }
  await detectPush().catch(() => {});
  render();
  if (S.tab === "together") loadMembers();
}

start();
