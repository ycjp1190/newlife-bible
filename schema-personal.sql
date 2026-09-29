-- "말씀 읽고 새 인생" 개인 모드(MODE=personal) D1 데이터베이스 구조
-- 모임 모드(schema.sql)와 달리 사람마다 시작일·읽기표·변경 기록을 따로 가진다.

-- 새 사람이 시작할 때 복사해 가는 기본 읽기표 (data/seed.sql 로 채운다)
CREATE TABLE IF NOT EXISTS plan_days (
  day INTEGER PRIMARY KEY,
  chapters TEXT NOT NULL
);

-- 사람별 읽기표. chapters = [["책", 장], ...] JSON
CREATE TABLE IF NOT EXISTS member_plan (
  member_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  chapters TEXT NOT NULL,
  PRIMARY KEY (member_id, day)
);

-- 사람별 읽기표·시작일 변경 기록 (되돌리기용)
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  day INTEGER,
  before_value TEXT,
  after_value TEXT,
  member_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_member ON history (member_id, id);

-- 이름은 겹쳐도 된다. 다른 기기에서 이어 쓰기는 복구 코드로 한다.
CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  recovery_code TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  morning TEXT NOT NULL DEFAULT '06:30',
  lunch TEXT NOT NULL DEFAULT '12:30',
  evening TEXT NOT NULL DEFAULT '21:00',
  morning_on INTEGER NOT NULL DEFAULT 1,
  lunch_on INTEGER NOT NULL DEFAULT 1,
  evening_on INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS checks (
  member_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  chapter TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (member_id, day, chapter)
);

CREATE TABLE IF NOT EXISTS sent_log (
  member_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  PRIMARY KEY (member_id, date, slot)
);
