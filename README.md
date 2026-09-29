# 말씀 읽고 새 인생

397일 동안 모임이 함께 성경 전체(1,189장)를 읽도록 돕는 **설치형 웹앱(PWA)** 입니다.
아이폰·갤럭시 모두 인터넷 주소 하나로 설치하고, 매일 읽을 곳을 알림으로 받습니다.

- 앱 주소: https://malsseum-new-life.newlife-bible.workers.dev
- 입장에는 모임에서 받은 **초대 코드**가 필요합니다. (이 저장소에는 적지 않습니다)

## 기능
- **오늘**: 오늘의 DAY, PART, 장(章)마다 체크박스 (3장이면 3개, 1장이면 1개)
- **밀린 읽기**: 지난 날 중 다 못 읽은 날 목록 — 바로 체크 가능
- **함께**: 구성원별 진행률, 밀린 날 수, 오늘 완료 여부
- **일정**: DAY 1–397 전체, 날짜별 범위 수정(누구나), 전체 표 직접 편집, 변경 기록·되돌리기
- **설정**: 아침/점심/저녁 알림 시간(5분 단위, 각자 켜기·끄기), 모임 시작일(DAY 1), 이름
- **알림 규칙**: 아침 = 오늘 읽을 곳 / 점심·저녁 = 그날 분량을 다 체크하지 않은 사람에게만

## 🙋 팀원: 앱을 고치고 싶을 때
코드를 몰라도 **Claude Code**에게 말로 부탁하면 됩니다. 이 저장소의 [CLAUDE.md](CLAUDE.md)에 규칙이 적혀 있어 Claude가 알아서 따릅니다.

1. GitHub 계정으로 로그인합니다.
2. Claude Code에서 이 저장소를 엽니다.
   - 웹: https://claude.ai/code 에서 GitHub 연결 → 저장소 `ycjp1190/newlife-bible` 선택
   - 내 컴퓨터: `gh repo fork ycjp1190/newlife-bible --clone` 후 그 폴더에서 Claude Code 실행
3. 바라는 점을 말합니다. 예: *"오늘 화면의 체크박스를 더 크게 하고, 색을 따뜻한 갈색 계열로 바꿔 줘. 미리보기로 확인하고 PR로 올려 줘."*
4. Claude가 **PR(변경 제안)** 을 올리면, 저장소 주인이 확인 후 승인합니다. 승인되면 몇 분 안에 모든 사람의 앱에 자동 반영됩니다.

> 바로 반영되지 않고 꼭 승인을 거치는 이유: 실수 하나가 모임 전체의 앱에 바로 적용되는 것을 막기 위해서입니다.

## 읽기 범위 바꾸기 (코드 수정 없이 앱에서)
- **일정** 탭 → 날짜 누르기 → "읽기 범위 바꾸기"에 `사도행전 28장 · 로마서 1–2장`처럼 적고 저장. 체크박스 수가 자동으로 바뀝니다.
- 여러 날은 **전체 표 직접 편집** (한 줄에 `DAY 1: 누가복음 1–3장`).
- 모든 변경은 **변경 기록**에 남고 **되돌리기** 할 수 있습니다.

## 구조와 개발
구조, 작업 규칙, 확인 방법은 [CLAUDE.md](CLAUDE.md)를 보세요.

```bash
node --test tests/*.test.mjs                     # 자동 검사
deno run -A scripts/local-server.mjs   # 미리보기 → http://localhost:8787/?invite=test
```

## 배포 (자동)
`main`에 반영되면 GitHub Actions가 검사 후 Cloudflare에 배포합니다. 필요한 비밀값은 저장소 설정의 `CLOUDFLARE_API_TOKEN` 하나이며, 알림 키·초대 코드는 Cloudflare에만 저장되어 있습니다.

<details>
<summary>처음부터 새로 설치하는 방법 (저장소 주인용)</summary>

1. `npm install` → `npx wrangler login`
2. `npx wrangler d1 create malsseum` → `database_id`를 `wrangler.toml`에
3. `npm run db:remote` (표 만들기 + 기본 읽기표)
4. `node scripts/gen-vapid.mjs` → 공개키는 `wrangler.toml`, 비밀키는 `npx wrangler secret put VAPID_PRIVATE_KEY`
5. `npx wrangler secret put INVITE_CODE`
6. `npm run deploy`
</details>

## 알아둘 점
- 누구나 범위·시작일을 바꿀 수 있으므로 초대 링크는 모임 안에서만 공유하세요.
- 같은 이름 + 초대 코드면 그 사람으로 입장됩니다. (비밀번호 없는 간단한 방식)
- 아이폰은 iOS 16.4 이상 + 홈 화면에 추가한 앱에서만 알림을 받습니다.
- 알림 시간은 5분 단위, 한국 시간 기준입니다.
