-- 모임 모드: 홈 화면 앱(설치형)으로 연 기록 — 관리자 탭 사용자 현황용 (개인용 0002 와 같음)
ALTER TABLE members ADD COLUMN app_first_at TEXT; -- 설치형 앱으로 처음 연 시각
ALTER TABLE members ADD COLUMN app_last_at TEXT;  -- 설치형 앱으로 마지막 연 시각
