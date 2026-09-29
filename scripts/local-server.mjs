// 로컬 미리보기 서버 (Deno 로 실행). 실제 배포는 GitHub Actions 가 Cloudflare 에 한다.
// 모임 모드: deno run -A scripts/local-server.mjs            → http://localhost:8787/?invite=test
// 개인 모드: deno run -A scripts/local-server.mjs personal   → http://localhost:8788/
// - Cloudflare D1 대신 내장 SQLite 파일(.local/*.sqlite)을 쓴다. 실제 모임 기록과 무관하다.
// - 알림 예약 실행은 /__cron?at=2026-10-01T06:30 (한국 시각) 으로 흉내 낼 수 있다.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createLocalDB, root } from "./d1-local.mjs";
import worker from "../worker/index.js";

const mode = Deno.args[0] === "personal" ? "personal" : "group";
const port = mode === "personal" ? 8788 : 8787;
mkdirSync(root + ".local", { recursive: true });
const dbPath = root + `.local/${mode}.sqlite`;
const DB = createLocalDB({ mode, path: dbPath, fresh: !existsSync(dbPath) });

const TYPES = { html: "text/html; charset=utf-8", js: "text/javascript; charset=utf-8", css: "text/css; charset=utf-8",
  png: "image/png", svg: "image/svg+xml", webmanifest: "application/manifest+json", json: "application/json" };
const ASSETS = {
  async fetch(request) {
    let path = new URL(request.url).pathname;
    if (path.endsWith("/")) path += "index.html";
    const file = root + "public" + decodeURIComponent(path);
    const target = existsSync(file) && !file.includes("..") ? file : root + "public/index.html";
    const ext = target.split(".").pop();
    return new Response(readFileSync(target), { headers: { "Content-Type": TYPES[ext] || "application/octet-stream" } });
  },
};

const vars = existsSync(root + ".dev.vars")
  ? Object.fromEntries(readFileSync(root + ".dev.vars", "utf8").split("\n")
    .map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]))
  : {};
const env = {
  DB, ASSETS, INVITE_CODE: "test", VAPID_SUBJECT: "https://localhost", ...vars,
  ...(mode === "personal" ? { MODE: "personal" } : {}),
};

Deno.serve({ port }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/__cron") {
    const at = url.searchParams.get("at"); // 한국 시각 "YYYY-MM-DDTHH:MM"
    const now = at ? Date.parse(at + ":00+09:00") : Date.now();
    const pending = [];
    await worker.scheduled({ scheduledTime: now }, env, { waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return new Response(`cron ran at ${new Date(now).toISOString()}\n`);
  }
  return worker.fetch(request, env, { waitUntil() {} });
});
console.log(`로컬 서버 (${mode === "personal" ? "개인" : "모임"} 모드): http://localhost:${port}/${mode === "personal" ? "" : "?invite=test"}`);
