-- 모임 모드: 중도 참여. 이 DAY 부터 모임과 같이 읽는다 (그 전 날은 밀린 장·벌금에서 빠지고, 원하면 따로 읽는다)
-- 기존 모임원은 1 (지금과 똑같이 DAY 1 부터)
ALTER TABLE members ADD COLUMN join_day INTEGER NOT NULL DEFAULT 1;
