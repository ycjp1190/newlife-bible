# 말씀 읽고 새 인생 — AI 작업 안내

이 파일은 Claude Code(및 다른 AI 코딩 도구)가 이 저장소에서 작업할 때 먼저 읽는 안내서다.
사용자는 대부분 개발자가 아닌 모임 구성원이다. **한국어 존댓말**로, 전문용어는 풀어서 설명한다.

## 앱 한 줄 요약
모임이 397일 동안 함께 성경 전체(1,189장)를 읽도록, 매일 읽을 곳을 알림으로 보내고 장마다 체크하게 하는 설치형 웹앱(PWA).
- 실제 주소: https://malsseum-new-life.newlife-bible.workers.dev (초대 코드는 저장소에 적지 않는다)
- 호스팅: Cloudflare Worker `malsseum-new-life` + D1 데이터베이스 `malsseum` + 5분마다 예약 실행(알림)
- 배포: `main` 브랜치에 반영되면 GitHub Actions(`.github/workflows/deploy.yml`)가 자동 배포한다.

## 구조
| 경로 | 역할 |
|---|---|
| `public/index.html` | 화면 틀 (글꼴, 아이콘, manifest 연결) |
| `public/style.css` | **디자인 전부** — 색은 맨 위 `:root` 변수(밝은/어두운 화면 각각)에서 바꾼다 |
| `public/app.js` | 화면 그리기와 동작 (탭: 오늘/함께/일정/설정, 입장, 체크, 범위 수정, 알림 켜기) |
| `public/sw.js` | 서비스워커: 푸시 알림 표시, 알림 누르면 앱 열기, 오프라인 보관 |
| `public/manifest.webmanifest`, `public/icons/` | 앱 이름·아이콘 (홈 화면 설치용) |
| `public/shared/bible.js` | 성경 책·장 수·PART, 범위 글 해석/표기, 한국 시간 날짜 계산 — **화면과 서버가 같이 씀** |
| `worker/index.js` | 서버 API(`/api/*`)와 예약 알림 실행 |
| `worker/logic.js` | 진도·밀린 날 계산, 알림 보낼지·문구 판단 (순수 함수) |
| `worker/push.js` | 웹 푸시 암호화·서명 (외부 라이브러리 없음) |
| `schema.sql` | DB 표 구조 |
| `data/seed.sql`, `data/plan-397.json` | 기본 397일 읽기표 (`scripts/build-plan.mjs`로 생성) |
| `scripts/local-server.mjs` | 로컬 미리보기 서버 (Deno, 실제 DB·알림과 무관) |
| `tests/app.test.mjs` | 자동 검사 |

## 작업 규칙
1. **디자인 변경은 `public/` 안에서만** 한다. 특히 `style.css`의 `:root` 색 변수와 각 부분 스타일을 우선 사용한다.
2. 휴대폰 세로 화면(폭 360–430px)을 기준으로 만들고, 밝은 화면과 어두운 화면 **둘 다** 확인한다.
3. 화면의 한국어 문구는 존댓말, 짧고 쉬운 말로 쓴다.
4. 아래는 **바꾸지 않는다** (필요하면 저장소 주인에게 먼저 물어본다):
   - `wrangler.toml`의 이름·데이터베이스·예약 주기·`VAPID_PUBLIC_KEY` (바꾸면 모든 사람의 알림이 끊긴다)
   - `worker/push.js` (알림 암호화)
   - `schema.sql` (이미 운영 중인 DB에는 자동 반영되지 않는다. 표를 바꾸려면 주인이 따로 DB 명령을 실행해야 한다)
   - `.github/workflows/deploy.yml`
5. 비밀값(초대 코드, 알림 비밀키, Cloudflare 토큰)은 **절대** 파일에 적거나 커밋하지 않는다. 이 값들은 Cloudflare와 GitHub 비밀값 보관함에만 있다.
6. **직접 배포하지 않는다** (`wrangler deploy` 금지). 변경은 새 브랜치 → PR(변경 제안)로 올리고, 저장소 주인이 승인하면 자동 배포된다.
7. `public/` 파일을 바꿨으면 `public/sw.js`의 `CACHE` 이름 숫자를 하나 올린다 (예: `malsseum-v1` → `malsseum-v2`). 설치된 앱이 새 파일을 받게 하기 위함이다.
8. 읽기 범위(날짜별 본문)는 **앱 안에서** 바꾸는 것이 원칙이다 (일정 탭 → 날짜 → 범위 바꾸기 / 전체 표 직접 편집). 코드의 기본 읽기표는 새로 만드는 DB의 초기값일 뿐이다.

## 확인 방법
```bash
node --test tests/                     # 자동 검사 (Node 22 이상)
deno run -A scripts/local-server.mjs   # 미리보기 → http://localhost:8787/?invite=test
```
- 미리보기는 내 컴퓨터 안의 가짜 DB(`.local/dev.sqlite`)를 쓰므로 실제 모임 기록에 영향이 없다. 처음 열면 **설정 → 모임 시작일**을 정해야 오늘 화면이 보인다.
- 미리보기 결과는 휴대폰 크기와 밝은/어두운 화면에서 스크린샷으로 확인한 뒤 PR에 설명을 적는다.
- Deno가 없으면 설치(`brew install deno` 또는 https://deno.com)하거나, 자동 검사만 돌리고 PR에 그 사실을 적는다.

## PR(변경 제안) 올리기
1. `git checkout -b design/짧은-설명` 으로 새 브랜치
2. 수정 → 검사·미리보기 확인 → 커밋
3. `gh pr create` — 제목과 본문은 한국어로, 무엇을 왜 바꿨는지와 확인한 내용(스크린샷)을 적는다
4. 저장소에 쓰기 권한이 없는 팀원은 `gh repo fork`로 복사본을 만들어 거기서 PR을 올린다
