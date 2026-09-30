// 실행: deno test -A tests/   또는   node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDefaultPlan, dayIndex, formatChapters, parseChapters, streakDays } from "../public/shared/bible.js";
import { buildMessage, dueSlots, progress } from "../worker/logic.js";
import { b64urlDecode, b64urlEncode, encryptPayload, generateVapidKeys, vapidJwt } from "../worker/push.js";

test("읽기 범위 해석과 표기", () => {
  assert.deepEqual(parseChapters("사도행전 28장 · 로마서 1-2장").chapters, [["사도행전", 28], ["로마서", 1], ["로마서", 2]]);
  assert.deepEqual(parseChapters("롬 3~5").chapters, [["로마서", 3], ["로마서", 4], ["로마서", 5]]);
  assert.deepEqual(parseChapters("쉬는 날").chapters, []);
  assert.match(parseChapters("로마서 17장").error, /1–16장/);
  assert.match(parseChapters("없는책 1장").error, /책 이름이 아니에요/);
  assert.equal(formatChapters([["요한일서", 4], ["요한일서", 5], ["요한이서", 1]]), "요한일서 4–5장 · 요한이서 1장");
});

test("기본 읽기표: 397일, 마지막 날 1장", () => {
  const plan = buildDefaultPlan(3);
  assert.equal(plan.length, 397);
  assert.equal(formatChapters(plan[17].chapters), "사도행전 28장 · 로마서 1–2장");
  assert.equal(formatChapters(plan[396].chapters), "요한계시록 22장");
});

test("날짜 → DAY 번호", () => {
  assert.equal(dayIndex("2026-10-01", "2026-10-01"), 1);
  assert.equal(dayIndex("2026-10-01", "2026-09-29"), -1);
  assert.equal(dayIndex("2026-02-27", "2026-03-02"), 4);
});

const plan = [
  { day: 1, chapters: [["누가복음", 1], ["누가복음", 2], ["누가복음", 3]] },
  { day: 2, chapters: [["누가복음", 4], ["누가복음", 5], ["누가복음", 6]] },
  { day: 3, chapters: [["누가복음", 7], ["누가복음", 8]] },
];

test("진도: 밀린 날과 오늘 남은 장", () => {
  const checked = new Map([[1, new Set(["누가복음 1", "누가복음 2", "누가복음 3"])], [3, new Set(["누가복음 7"])]]);
  const p = progress(plan, "2026-10-01", "2026-10-03", checked);
  assert.equal(p.todayDay, 3);
  assert.deepEqual(p.missed, [2]);
  assert.equal(p.doneDays, 1);
  assert.deepEqual(p.todayRemaining, [["누가복음", 8]]);
  assert.equal(p.todayDone, false);
});

test("알림 시각 판단 (60분 안 따라잡기, 중복 방지, 꺼짐)", () => {
  const m = { morning: "06:30", lunch: "12:30", evening: "21:00", morning_on: 1, lunch_on: 1, evening_on: 0 };
  assert.deepEqual(dueSlots(m, "06:30", new Set()), ["morning"]);
  assert.deepEqual(dueSlots(m, "07:25", new Set()), ["morning"]);
  assert.deepEqual(dueSlots(m, "07:30", new Set()), []);
  assert.deepEqual(dueSlots(m, "06:35", new Set(["morning"])), []);
  assert.deepEqual(dueSlots(m, "21:00", new Set()), []);
});

test("알림 문구: 점심·저녁은 다 읽은 사람에게 보내지 않음", () => {
  const notDone = progress(plan, "2026-10-01", "2026-10-02", new Map());
  assert.equal(buildMessage("morning", notDone).body, "누가복음 4–6장 · 밀린 읽기 1일");
  assert.match(buildMessage("lunch", notDone).body, /3장 남았어요/);
  const done = progress(plan, "2026-10-01", "2026-10-01", new Map([[1, new Set(["누가복음 1", "누가복음 2", "누가복음 3"])]]));
  assert.equal(buildMessage("evening", done), null);
  assert.ok(buildMessage("morning", done));
  const before = progress(plan, "2026-10-01", "2026-09-30", new Map());
  assert.equal(buildMessage("morning", before), null);
});

// 받는 쪽(폰 브라우저) 복호화를 흉내 내서 암호화가 표준대로 되는지 확인
async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8));
}

test("웹 푸시 암호화(aes128gcm) 왕복", async () => {
  const enc = new TextEncoder();
  const ua = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ua.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  const body = await encryptPayload({ p256dh: b64urlEncode(uaPublic), auth: b64urlEncode(auth) }, '{"title":"안녕"}');

  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const cipher = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, ua.privateKey, 256));
  const info = new Uint8Array([...enc.encode("WebPush: info\0"), ...uaPublic, ...asPublic]);
  const ikm = await hkdf(auth, ecdh, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, cipher));
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(new TextDecoder().decode(plain.slice(0, -1)), '{"title":"안녕"}');
});

test("VAPID 서명 검증", async () => {
  const keys = await generateVapidKeys();
  const jwt = await vapidJwt("https://push.example", "https://app.example", keys);
  const [h, b, s] = jwt.split(".");
  const pub = await crypto.subtle.importKey("raw", b64urlDecode(keys.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, b64urlDecode(s), new TextEncoder().encode(`${h}.${b}`));
  assert.ok(ok);
  assert.equal(JSON.parse(new TextDecoder().decode(b64urlDecode(b))).aud, "https://push.example");
});

test("연속 읽기 일수", () => {
  const doneSet = (days) => (d) => days.includes(d);
  assert.equal(streakDays(5, 397, doneSet([3, 4, 5])), 3); // 오늘까지 3일
  assert.equal(streakDays(5, 397, doneSet([2, 3, 4])), 3); // 오늘은 아직 → 어제까지 3일
  assert.equal(streakDays(5, 397, doneSet([1, 2, 4, 5])), 2); // 3일에 끊김
  assert.equal(streakDays(5, 397, doneSet([1, 2, 3])), 0); // 어제를 놓침
  assert.equal(streakDays(0, 397, doneSet([])), 0); // 시작 전
  const plan = [
    { day: 1, chapters: [["누가복음", 1]] }, { day: 2, chapters: [["누가복음", 2]] }, { day: 3, chapters: [["누가복음", 3]] },
  ];
  const checked = new Map([[1, new Set(["누가복음 1"])], [2, new Set(["누가복음 2"])]]);
  assert.equal(progress(plan, "2026-10-01", "2026-10-03", checked).streak, 2);
});
