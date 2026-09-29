-- "말씀 읽고 새 인생" D1(SQLite) 데이터베이스 구조

-- 모임 공통 설정 (start_date: DAY 1 날짜)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 날짜별 읽기 범위. chapters = [["책", 장], ...] JSON. 체크박스 수 = 장 수
CREATE TABLE IF NOT EXISTS plan_days (
  day INTEGER PRIMARY KEY,
  chapters TEXT NOT NULL
);

-- 읽기표·시작일 변경 기록 (되돌리기용)
-- kind: 'day'(하루 범위) | 'bulk'(전체 표 직접 편집) | 'start_date'
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  day INTEGER,
  before_value TEXT,
  after_value TEXT,
  member_name TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  token TEXT NOT NULL,
  morning TEXT NOT NULL DEFAULT '06:30',
  lunch TEXT NOT NULL DEFAULT '12:30',
  evening TEXT NOT NULL DEFAULT '21:00',
  morning_on INTEGER NOT NULL DEFAULT 1,
  lunch_on INTEGER NOT NULL DEFAULT 1,
  evening_on INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_seen_at TEXT
);

-- 기기별 웹 푸시 구독 (한 사람이 여러 기기 가능)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  member_id INTEGER NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 장별 체크 기록. chapter = "로마서 1" 형식 (범위가 바뀌어도 같은 장이면 체크 유지)
CREATE TABLE IF NOT EXISTS checks (
  member_id INTEGER NOT NULL,
  day INTEGER NOT NULL,
  chapter TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (member_id, day, chapter)
);

-- 같은 알림을 두 번 보내지 않기 위한 발송 기록 (slot: morning | lunch | evening)
CREATE TABLE IF NOT EXISTS sent_log (
  member_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  slot TEXT NOT NULL,
  PRIMARY KEY (member_id, date, slot)
);
