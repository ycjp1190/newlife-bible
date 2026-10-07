-- 개인 모드: 못 읽은 분량 처리 방식. 기존 사용자는 'skip'(패스 = 지금 방식), 안내 팝업은 아직 안 봄
ALTER TABLE members ADD COLUMN catch_up TEXT NOT NULL DEFAULT 'skip';     -- 'skip'(패스: 날짜 기준, 못 읽은 날은 밀린 읽기) | 'flow'(이어 읽기: 못 읽은 곳부터)
ALTER TABLE members ADD COLUMN catch_up_asked INTEGER NOT NULL DEFAULT 0; -- 안내 팝업을 봤는지 (새 사용자는 고를 때 1)
