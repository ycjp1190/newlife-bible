-- 모임 모드: 대화 메시지 수정 (본인 메시지만). 수정한 시각 — 말풍선 옆에 '수정됨' 표시
ALTER TABLE messages ADD COLUMN edited_at TEXT;
