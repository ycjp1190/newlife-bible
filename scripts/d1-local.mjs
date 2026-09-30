// Cloudflare D1 을 흉내 내는 작은 도우미 (내장 SQLite 사용)
// 로컬 미리보기(local-server.mjs)와 자동 검사(tests/)에서 쓴다. 실제 배포와는 무관하다.
import { DatabaseSync } from "node:sqlite";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("..", import.meta.url));

// 개인 모드 DB 변경 파일 (실제 배포에서는 wrangler d1 migrations apply 가 차례로 적용한다)
export function personalMigrations() {
  const dir = root + "migrations-personal/";
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(dir + f, "utf8"));
}

// mode: "group" | "personal",  path: SQLite 파일 경로 (":memory:" 면 메모리에만)
// fresh 가 true 면 표를 만들고 기본 읽기표를 넣는다. migrate 가 false 면 개인 모드 변경 파일을 적용하지 않는다(옛 구조 흉내).
export function createLocalDB({ mode = "group", path = ":memory:", fresh = true, migrate = true } = {}) {
  const sqlite = new DatabaseSync(path);
  if (fresh) {
    sqlite.exec(readFileSync(root + (mode === "personal" ? "schema-personal.sql" : "schema.sql"), "utf8"));
    sqlite.exec(readFileSync(root + "data/seed.sql", "utf8"));
    if (mode === "personal" && migrate) for (const sql of personalMigrations()) sqlite.exec(sql);
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
    // 검사용: SQL 직접 실행 (예: 변경 파일 적용)
    exec: (sql) => sqlite.exec(sql),
  };
}
