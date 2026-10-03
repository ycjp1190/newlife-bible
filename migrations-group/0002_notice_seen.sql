-- 모임 모드: 확인한 업데이트 소식 번호 (public/shared/notices.js 의 GROUP_NOTICES). 기존 모임원은 0 = 소식 안 봄
-- 읽는 요일(모두 공통)은 settings 표의 read_days·sched 키에 둔다 (표 구조 변경 없음)
ALTER TABLE members ADD COLUMN notice_seen INTEGER NOT NULL DEFAULT 0;
