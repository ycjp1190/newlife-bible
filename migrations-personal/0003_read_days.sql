-- 개인 모드: 읽는 요일 선택, 업데이트 소식 확인 여부. 기존 사용자는 '매일 · 소식 안 봄' 으로 시작한다.
ALTER TABLE members ADD COLUMN read_days INTEGER NOT NULL DEFAULT 127; -- 요일 묶음 (일=1 … 토=64, 127 = 매일)
ALTER TABLE members ADD COLUMN sched TEXT;                             -- 요일을 도중에 바꾼 구간 기록 JSON [{date, day, mask}]. 없으면 시작일부터 read_days
ALTER TABLE members ADD COLUMN notice_seen INTEGER NOT NULL DEFAULT 0; -- 확인한 업데이트 소식 번호 (public/shared/notices.js)
