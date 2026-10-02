-- 모임 모드: 대화(단톡방). 기존 표는 건드리지 않고 새 표·새 칸만 더한다.

-- kind: 'text'(일반 메시지) | 'done'(읽기 완료 자동 소식, day = 완료한 DAY)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  day INTEGER,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
-- 읽기 완료 소식은 한 사람당 같은 DAY 에 한 번만
CREATE UNIQUE INDEX IF NOT EXISTS messages_done_once ON messages (member_id, day) WHERE kind = 'done';

-- 공감 (🙏 ❤️ 👍)
CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL,
  member_id INTEGER NOT NULL,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, member_id, emoji)
);

-- 대화 알림 켜기(기본 켜짐), 어디까지 읽었는지(안 읽은 수 계산용)
ALTER TABLE members ADD COLUMN chat_push INTEGER NOT NULL DEFAULT 1;
ALTER TABLE members ADD COLUMN last_read_msg INTEGER NOT NULL DEFAULT 0;
