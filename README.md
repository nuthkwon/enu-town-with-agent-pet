# ENU Town 🧚 — 사내 메타버스 + Claude 연동 요정 펫

ENU Town은 ENU-Tech 사무실(대덕비즈센터 A동 606호)을 그대로 옮긴 게더타운형 2D 공간입니다.

- **로그인:** 회사 Google 계정(@enu-tech.co.kr)만 쓸 수 있습니다.
- **캐릭터:** 윙스클럽 풍의 오리지널 픽셀 캐릭터로, 톡톡 뛰어다닙니다. 각자 지정된 자리에서 시작합니다.
- **펫:** 캐릭터마다 날개 달린 요정 펫이 따라다닙니다. 각자 연동한 **Claude(Team/Enterprise)** 가 쓴 할 일 점검 문구만 머리 위 말풍선으로 보여 주며, 말풍선은 본인에게만 보입니다.
- **동료 클릭:** 동료를 누르면 다음을 볼 수 있습니다.
  - **지금 하는 일**: 그 사람의 Claude가 주기적으로 쓴 업무 로그
  - **지난 대화**: 타운 채팅과, 본인이 공개한 Claude 업무 대화 요약
  - **업무 요청**: 팀별 템플릿(예: 품질보증팀에는 검토 요청)

> 회사 서버는 LLM을 호출하지 않고, 직원의 Claude 대화 원문도 보지 않습니다. 직원의 Claude가 ENU Town 커넥터(MCP)에 로그인해서 직접 기록합니다. 자세한 내용은 [docs/architecture.md](docs/architecture.md), [ADR 0001](docs/adr/0001-auth-direction.md)을 보세요.

## 구성
| 위치 | 역할 |
|---|---|
| `apps/web` | Next.js 16: 화면, Google 로그인, Claude 커넥터용 OAuth 서버, `/api/mcp`, REST, Phaser 게임 |
| `apps/realtime` | Colyseus 0.18: 이동, 펫, 채팅·DM, 말풍선 표시 |
| `apps/worker` | pg-boss: 넛지 만료, 연결 상태, 보존 기간 정리 |
| `packages/*` | 공용 계약(shared, protocol), 도메인 규칙, DB, 인증, MCP 도구, 맵, 픽셀 아트 |
| `claude/` | Claude 조직 플러그인 (`enu-town-checkin`, `enu-town-setup` 스킬) |
| `docs/` | 관리자 런북, 직원 안내, 개인정보 고지, ADR, 파일럿 체크리스트 |

## 로컬 개발
준비물: Node 22.12 이상(운영 24), pnpm 12, Postgres 16 이상.

```bash
pnpm install
# DB 준비
createdb enu_town_dev && createdb enu_town_test        # 또는 docker compose -f compose.dev.yaml up -d postgres
export DATABASE_URL=postgres://enu:enu@127.0.0.1:5432/enu_town_dev
pnpm db:migrate
cp config/seats.example.json config/seats.local.json    # 실제 명단으로 수정 (깃에 올리지 않음)
pnpm seed:seats && pnpm seed:dev                          # 좌석·공휴일 + 데모 사용자
pnpm sprites:build && pnpm map:check
# apps/web/.env.local, apps/realtime/.env 작성 (deploy/env/*.example 참고, DEV_LOGIN_ENABLED=1)
pnpm dev                                                  # web :3000, realtime :2567, worker
```
개발 로그인(`DEV_LOGIN_ENABLED=1`, 운영에서는 부팅 거부)으로 `dev.l1a@enu-tech.co.kr` 같은 데모 계정에 들어갈 수 있습니다.

## 검사
```bash
pnpm check:policy && pnpm lint && pnpm typecheck && pnpm test
DATABASE_URL_TEST=postgres://enu:enu@127.0.0.1:5432/enu_town_test pnpm test:int
pnpm test:e2e
scripts/check-oauth-discovery.sh http://localhost:3000
```

## 배포 (Docker Compose)
```bash
cp .env.example .env                               # PUBLIC_HOST(공개 HTTPS 호스트) 등
cp deploy/env/web.env.example deploy/env/web.env   # realtime/worker/postgres도 같은 방식으로 작성
docker compose up -d --build
```
- `/api/mcp`와 OAuth 경로는 Claude가 접속할 수 있도록 공개 HTTPS여야 합니다.
- 이후 단계는 [관리자 런북](docs/admin-runbook.ko.md)과 [직원 안내](docs/employee-onboarding.ko.md)를 따르세요.

## 개인정보
[docs/privacy-notice.ko.md](docs/privacy-notice.ko.md)를 보세요. 업무 로그는 기본으로 전사에 공개되며 로그마다 비공개로 바꿀 수 있습니다. Claude 대화 요약은 본인이 공개를 선택할 때만 보입니다. 성과 평가에는 사용하지 않습니다.
