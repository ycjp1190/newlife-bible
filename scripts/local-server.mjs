// 로컬 미리보기 서버 (Node 없이 Deno로 실행). 실제 배포는 Cloudflare(wrangler)를 사용한다.
// 실행: deno run -A scripts/local-server.mjs   → http://localhost:8787/?invite=test
// - Cloudflare D1 대신 내장 SQLite 파일(.local/dev.sqlite)을 쓴다.
// - 알림 예약 실행은 http://localhost:8787/__cron?at=2026-10-01T06:30 로 흉내 낼 수 있다.
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import worker from "../worker/index.js";

const root = fileURLToPath(new URL("..", import.meta.url));
mkdirSync(root + ".local", { recursive: true });
const dbPath = root + ".local/dev.sqlite";
const fresh = !existsSync(dbPath);
const sqlite = new DatabaseSync(dbPath);
if (fresh) {
  sqlite.exec(readFileSync(root + "schema.sql", "utf8"));
  sqlite.exec(readFileSync(root + "data/seed.sql", "utf8"));
}

// D1과 같은 모양의 아주 작은 흉내 객체
class Stmt {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Stmt(this.sql, params); }
  async first() { return sqlite.prepare(this.sql).get(...this.params) ?? null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
  async run() { sqlite.prepare(this.sql).run(...this.params); return { success: true }; }
}
const DB = {
  prepare: (sql) => new Stmt(sql),
  async batch(stmts) {
    sqlite.exec("BEGIN");
    try { for (const s of stmts) await s.run(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
    return [];
  },
};

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
const env = { DB, ASSETS, INVITE_CODE: "test", VAPID_SUBJECT: "https://localhost", ...vars };

Deno.serve({ port: 8787 }, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === "/__cron") {
    const at = url.searchParams.get("at"); // 한국 시각 "YYYY-MM-DDTHH:MM"
    const now = at ? Date.parse(at + ":00+09:00") : Date.now();
    const pending = [];
    await worker.scheduled({ scheduledTime: now }, env,{ waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
    return new Response(`cron ran at ${new Date(now).toISOString()}\n`);
  }
  return worker.fetch(request, env, { waitUntil() {} });
});
console.log(`로컬 서버: http://localhost:8787/?invite=${env.INVITE_CODE}`);
