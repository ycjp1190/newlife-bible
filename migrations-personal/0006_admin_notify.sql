-- 관리자 코드로 로그인한 회원: 새 의견·제보 알림 (기존 회원은 꺼짐)
ALTER TABLE members ADD COLUMN admin_notify INTEGER NOT NULL DEFAULT 0;
