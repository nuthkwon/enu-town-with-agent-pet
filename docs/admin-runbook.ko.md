# ENU Town 관리자 런북 (Claude Team / Enterprise 공통)

ENU Town은 각 직원의 **본인 Claude**가 ENU Town 커넥터(원격 MCP 서버)를 통해 업무 로그·할 일·펫 메시지를
쓰는 구조입니다. ENU Town은 Claude 계정에 로그인하거나 claude.ai 자격증명을 다루지 않습니다.
Claude가 ENU Town에 로그인합니다(ENU Town이 OAuth 2.1 인가 서버, 로그인은 회사 Google 계정).

> 2026-10-29 기준 Claude 문서로 확인한 내용입니다. Claude 설정 이름과 기본값은 바뀔 수 있으니 분기마다 다시 확인하세요.

## 0. 사전 준비 (IT)

| 항목 | 내용 |
|---|---|
| 호스트명 | 예: `town.enu-tech.co.kr`. **커넥터를 등록한 뒤에는 인증 설정을 바꿀 수 없으므로**(삭제 후 재등록, 전원 재연결) 먼저 확정합니다. 개발용은 별도 호스트(`town-dev...`)와 별도 커넥터를 씁니다. |
| 공개 HTTPS | `/api/mcp`, `/.well-known/*`, `/api/auth/*`는 인터넷(최소 Claude 송신 대역 `160.79.104.0/21`)에서 접근 가능해야 합니다. 브라우저 화면은 Google 로그인으로 보호됩니다. |
| Google Cloud | 회사 조직 아래 프로젝트 생성 → OAuth 동의 화면 **내부(Internal)** → 웹 클라이언트 생성, 승인된 리디렉션 URI `https://<host>/api/auth/callback/google` → Workspace 관리 콘솔 > 보안 > API 제어에서 이 클라이언트를 **신뢰함(Trusted)** 으로 지정 |
| 서버 | `docker compose` (Postgres, web, realtime, worker, Caddy). `.env.example`(→ `.env`, `PUBLIC_HOST` 등)과 `deploy/env/*.env.example`을 복사해 값 입력 → `docker compose up -d` |
| 좌석 명단 | `config/seats.local.json`(깃에 올리지 않음)을 서버에 두고 `docker compose run --rm migrate node dist/seed-seats.mjs` 또는 개발 환경에서 `pnpm seed:seats` |
| 관리자 | `ADMIN_EMAILS`에 관리자 이메일(쉼표 구분) |

## 1. Claude 조직 설정

| 단계 | Team | Enterprise |
|---|---|---|
| **커스텀 커넥터 등록**: 조직 설정 > 커넥터 > 추가 > 사용자 지정(Custom) > 웹. URL `https://<host>/api/mcp`, 인증은 **"Claude의 게시된 ID 사용(Use Claude's published identity)"**(CIMD) | Owner / Primary Owner | Owner 또는 "Manage access to Libraries" 권한의 커스텀 역할 |
| **Cowork 클라우드 실행**("Run Cowork in the cloud") | 기본 켜짐 | **기본 꺼짐** → 켜고 대상 역할(그룹)에 부여 |
| 조직 설정 > Cowork > 권한: **"커넥터 도구에 '항상 허용' 허용"** | 기본 꺼짐 → **켜기** | 기본 꺼짐 → **켜기** |
| 역할별 커넥터 정책 | 해당 없음 | 새 역할은 모든 커넥터가 "승인 필요". 역할마다 ENU Town(최소 `get_my_context`, `post_work_log`, `upsert_todos`, `post_pet_nudges`)을 **항상 허용**으로 |
| 조직 설정 > 기능: **"새 작업을 자동 승인 모드로 시작"** | 기본 켜짐 | 기본 꺼짐 → 켜기(또는 작업별 설정 안내) |
| 플러그인 마켓플레이스: private GitHub 저장소에 `claude/` 폴더 내용을 올리고 조직 마켓플레이스로 연결 → `enu-town` 플러그인을 **기본 설치(Installed by default)** 또는 **필수(Required)** | 필요 | 필요 |
| 메모리: Owner가 허용(각 직원이 켬). 과거 대화 검색은 기본 켜짐 | 권장 | 권장 (CMEK 조직은 대화 검색 없음) |
| Google Calendar·Gmail 커넥터 활성화 | 권장 | 권장 |
| Claude 조직 SSO를 Google Workspace로 (Claude 계정과 ENU Town 로그인 신원을 일치) | 권장 | 권장 |
| **Compliance API** | — | ENU Town에는 **사용하지 않음** |

> 예약 작업은 직원 본인의 seat 사용량을 씁니다. Cowork 예약 프리셋은 매시간/매일/매주/평일/수동이며,
> 근무 시간(08:30–19:30) 밖과 주말·공휴일 실행은 ENU Town이 `skip`으로 즉시 끝내게 합니다.

## 2. Claude Code (개발자, 선택)

- claude.ai 구독 로그인 상태의 Claude Code는 조직 커넥터를 자동으로 불러옵니다(API 키 로그인은 불가).
- 서버 관리 설정으로 `claude/managed-settings/claude-code.managed.example.json`의 `claudeMd`를 배포하면,
  큰 작업을 마칠 때 Claude Code가 업무 로그를 갱신합니다. 도구 사전 허용(`permissions.allow`)은 Owner가 결정합니다.

## 3. 첫 연결 후 확인

1. 감사 로그(`audit_events`)의 `oauth.client_discovered` / `oauth.cimd_rejected`에서 Claude의 CIMD `client_id` 호스트를 확인합니다.
2. 필요하면 `CIMD_ALLOWED_HOSTS`를 실제 호스트로 좁히고 재시작합니다(기본 `claude.ai,claude.com,anthropic.com`).
3. 파일럿 체크리스트(`docs/pilot/claude-pilot-checklist.md`)를 진행합니다.

## 4. 운영

| 작업 | 방법 |
|---|---|
| 자리 재배정 | ENU Town `/admin` > 좌석 |
| 퇴사·비활성화 | `/admin` > 사용자 > 비활성화: 로그인 차단, 모든 토큰·커넥터 연결 폐기, 자리 해제. 같은 날 Claude 조직에서도 계정 정리 |
| 공휴일 | `packages/db/seed/kr-holidays.json` 매년 갱신 후 `pnpm seed:seats` |
| 백업 | Postgres 덤프를 암호화해 보관(`jwks`, OAuth 토큰 테이블 포함) |
| 커넥터 문제 | 직원: Claude 설정에서 ENU Town 해제 후 다시 연결 / ENU Town `/me`에서 연결 해제 후 재연결 |
