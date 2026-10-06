-- 의견·제보 (설정 → 의견 보내기). 관리자 탭에서 보고 답변한다.
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,             -- 답변을 본인에게 보여 주려고 항상 저장 (익명이어도)
  anonymous INTEGER NOT NULL DEFAULT 0,   -- 1 이면 관리자 화면에 이름을 보여 주지 않음
  kind TEXT NOT NULL,                     -- 'bug'(불편·오류) | 'idea'(개선 제안) | 'etc'(기타)
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',     -- new(접수) | seen(확인함) | done(반영됨) | closed(보류)
  reply TEXT,
  replied_at TEXT,
  reply_seen INTEGER NOT NULL DEFAULT 1,  -- 0 이면 제보자가 아직 답변을 안 봄 (설정 탭 빨간 점)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_member ON feedback (member_id, id);
