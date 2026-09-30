-- 개인 모드: 로드맵·하루 분량 선택, 계획 바꾸기(버전) 지원
-- 기존 사용자는 '예수님에서 시작하는 통독(flow397) · 하루 3장 · 버전 0' 이 되어 지금과 똑같이 동작한다.

ALTER TABLE members ADD COLUMN roadmap TEXT NOT NULL DEFAULT 'flow397';
ALTER TABLE members ADD COLUMN per_day INTEGER NOT NULL DEFAULT 3;
ALTER TABLE members ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE history ADD COLUMN plan_version INTEGER NOT NULL DEFAULT 0;

-- 체크 기록: 계획을 바꾸면 새 버전에서 DAY 1 부터 다시 체크하고, 이전 버전 기록은 그대로 보관한다.
CREATE TABLE checks_v2 (
  member_id INTEGER NOT NULL,
  plan_version INTEGER NOT NULL DEFAULT 0,
  day INTEGER NOT NULL,
  chapter TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  PRIMARY KEY (member_id, plan_version, day, chapter)
);
INSERT INTO checks_v2 (member_id, plan_version, day, chapter, checked_at)
  SELECT member_id, 0, day, chapter, checked_at FROM checks;
DROP TABLE checks;
ALTER TABLE checks_v2 RENAME TO checks;
