// Cloudflare D1 을 흉내 내는 작은 도우미 (내장 SQLite 사용)
// 로컬 미리보기(local-server.mjs)와 자동 검사(tests/)에서 쓴다. 실제 배포와는 무관하다.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

// mode: "group" | "personal",  path: SQLite 파일 경로 (":memory:" 면 메모리에만)
// fresh 가 true 면 표를 만들고 기본 읽기표를 넣는다.
export function createLocalDB({ mode = "group", path = ":memory:", fresh = true } = {}) {
  const sqlite = new DatabaseSync(path);
  if (fresh) {
    sqlite.exec(readFileSync(root + (mode === "personal" ? "schema-personal.sql" : "schema.sql"), "utf8"));
    sqlite.exec(readFileSync(root + "data/seed.sql", "utf8"));
  }

  class Stmt {
    constructor(sql, params = []) { this.sql = sql; this.params = params; }
    bind(...params) { return new Stmt(this.sql, params); }
    async first() { return sqlite.prepare(this.sql).get(...this.params) ?? null; }
    async all() { return { results: sqlite.prepare(this.sql).all(...this.params) }; }
    async run() { sqlite.prepare(this.sql).run(...this.params); return { success: true }; }
  }

  return {
    prepare: (sql) => new Stmt(sql),
    async batch(stmts) {
      sqlite.exec("BEGIN");
      try { for (const s of stmts) await s.run(); sqlite.exec("COMMIT"); } catch (e) { sqlite.exec("ROLLBACK"); throw e; }
      return [];
    },
  };
}
