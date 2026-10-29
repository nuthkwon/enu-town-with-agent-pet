# ENU Den 관리자 런북 (Claude Team / Enterprise 공통)

ENU Den은 각 직원의 **본인 Claude**가 ENU Den 커넥터(원격 MCP 서버)를 통해 업무 로그·활동·할 일·펫 메시지를
쓰는 구조입니다. 타운 화면의 아바타는 아무도 조작하지 않고, 서버가 각자의 상태·접속·일정으로 자리를 정합니다
([ADR 0004](adr/0004-town-is-a-visualization.md)). ENU Den은 Claude 계정에 로그인하거나 claude.ai 자격증명을 다루지 않습니다.
Claude가 ENU Den에 로그인합니다(ENU Den이 OAuth 2.1 인가 서버, 로그인은 회사 Google 계정).

> 2026-10-29 기준 Claude 문서로 확인한 내용입니다. Claude 설정 이름과 기본값은 바뀔 수 있으니 분기마다 다시 확인하세요.

## 0. 사전 준비 (IT)

| 항목         | 내용                                                                                                                                                                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 호스트명     | 예: `den.enu-tech.co.kr`. **커넥터를 등록한 뒤에는 인증 설정을 바꿀 수 없으므로**(삭제 후 재등록, 전원 재연결) 먼저 확정합니다. 개발용은 별도 호스트(`den-dev...`)와 별도 커넥터를 씁니다.                                                      |
| 공개 HTTPS   | `/api/mcp`, `/.well-known/*`, `/api/auth/*`는 인터넷(최소 Claude 송신 대역 `160.79.104.0/21`)에서 접근 가능해야 합니다. 브라우저 화면은 Google 로그인으로 보호됩니다.                                                                           |
| Google Cloud | 회사 조직 아래 프로젝트 생성 → OAuth 동의 화면 **내부(Internal)** → 웹 클라이언트 생성, 승인된 리디렉션 URI `https://<host>/api/auth/callback/google` → Workspace 관리 콘솔 > 보안 > API 제어에서 이 클라이언트를 **신뢰함(Trusted)** 으로 지정 |
| 서버         | `docker compose` (Postgres, web, realtime, worker, Caddy). `.env.example`(→ `.env`, `PUBLIC_HOST` 등)과 `deploy/env/*.env.example`을 복사해 값 입력 → `docker compose up -d`                                                                    |
| 좌석 명단    | `config/seats.local.json`(깃에 올리지 않음)을 서버에 두고 `docker compose run --rm migrate node dist/seed-seats.mjs` 또는 개발 환경에서 `pnpm seed:seats`                                                                                       |
| 관리자       | `ADMIN_EMAILS`에 관리자 이메일(쉼표 구분)                                                                                                                                                                                                       |
| 시행 전 검토 | 근로자 감시 설비 해당 여부 확인(인사·법무), 전 직원 설명회와 의견 수렴(30인 미만이라 노사협의회 의무가 없어도), 경영진의 "근태·평가 미사용" 서면 확인. 결과는 [ADR 0004](adr/0004-town-is-a-visualization.md)의 "Review before rollout"에 기록  |

## 1. Claude 조직 설정

| 단계                                                                                                                                                                                    | Team                  | Enterprise                                                                                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **커스텀 커넥터 등록**: 조직 설정 > 커넥터 > 추가 > 사용자 지정(Custom) > 웹. URL `https://<host>/api/mcp`, 인증은 **"Claude의 게시된 ID 사용(Use Claude's published identity)"**(CIMD) | Owner / Primary Owner | Owner 또는 "Manage access to Libraries" 권한의 커스텀 역할                                                                                                                                        |
| **Cowork 클라우드 실행**("Run Cowork in the cloud")                                                                                                                                     | 기본 켜짐             | **기본 꺼짐** → 켜고 대상 역할(그룹)에 부여                                                                                                                                                       |
| 조직 설정 > Cowork > 권한: **"커넥터 도구에 '항상 허용' 허용"**                                                                                                                         | 기본 꺼짐 → **켜기**  | 기본 꺼짐 → **켜기**                                                                                                                                                                              |
| 역할별 커넥터 정책                                                                                                                                                                      | 해당 없음             | 새 역할은 모든 커넥터가 "승인 필요". 역할마다 ENU Den 도구 여섯 가지(`get_my_context`, `post_pet_reply`, `post_work_log`, `post_activity`, `upsert_todos`, `post_pet_nudges`)를 **항상 허용**으로 |
| 조직 설정 > 기능: **"새 작업을 자동 승인 모드로 시작"**                                                                                                                                 | 기본 켜짐             | 기본 꺼짐 → 켜기(또는 작업별 설정 안내)                                                                                                                                                           |
| 플러그인 마켓플레이스: private GitHub 저장소에 `claude/` 폴더 내용을 올리고 조직 마켓플레이스로 연결 → `enu-den` 플러그인을 **기본 설치(Installed by default)** 또는 **필수(Required)** | 필요                  | 필요                                                                                                                                                                                              |
| 메모리: Owner가 허용(각 직원이 켬). 과거 대화 검색은 기본 켜짐                                                                                                                          | 권장                  | 권장 (CMEK 조직은 대화 검색 없음)                                                                                                                                                                 |
| Google Calendar·Gmail 커넥터 활성화 (활동 공유의 회의·집중·부재 일정은 캘린더에서 옴. `iCalUID`·참석자 수가 보이는지 파일럿에서 확인)                                                   | 권장                  | 권장                                                                                                                                                                                              |
| Claude 조직 SSO를 Google Workspace로 (Claude 계정과 ENU Den 로그인 신원을 일치)                                                                                                         | 권장                  | 권장                                                                                                                                                                                              |
| **Compliance API**                                                                                                                                                                      | —                     | ENU Den에는 **사용하지 않음**                                                                                                                                                                     |

> 예약 작업은 직원 본인의 seat 사용량을 씁니다. Cowork 예약 프리셋은 매시간/매일/매주/평일/수동이며,
> 근무 시간(08:30–19:30) 밖과 주말·공휴일 실행은 ENU Den이 `skip`으로 즉시 끝내게 합니다.

## 2. Claude Code (개발자, 선택)

- claude.ai 구독 로그인 상태의 Claude Code는 조직 커넥터를 자동으로 불러옵니다(API 키 로그인은 불가).
- 서버 관리 설정으로 `claude/managed-settings/claude-code.managed.example.json`의 `claudeMd`를 배포하면,
  큰 작업을 마칠 때 Claude Code가 업무 로그를 갱신합니다. 도구 사전 허용(`permissions.allow`)은 Owner가 결정합니다.

## 3. 첫 연결 후 확인

1. 감사 로그(`audit_events`)의 `oauth.client_discovered` / `oauth.cimd_rejected`에서 Claude의 CIMD `client_id` 호스트를 확인합니다.
2. 필요하면 `CIMD_ALLOWED_HOSTS`를 실제 호스트로 좁히고 재시작합니다(기본 `claude.ai,claude.com,anthropic.com`).
3. 파일럿 체크리스트(`docs/pilot/claude-pilot-checklist.md`)를 진행합니다.

## 4. 운영

| 작업           | 방법                                                                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 자리 재배정    | ENU Den `/admin` > 좌석                                                                                                                                                                                                              |
| 퇴사·비활성화  | `/admin` > 사용자 > 비활성화: 로그인 차단, 모든 토큰·커넥터 연결 폐기, 자리 해제. 같은 날 Claude 조직에서도 계정 정리                                                                                                                |
| 공휴일         | `packages/db/seed/kr-holidays.json` 매년 갱신 후 `pnpm seed:seats`                                                                                                                                                                   |
| 백업           | `deploy/scripts/backup.sh <age-recipient>`로 Postgres 덤프(`pg_dump -Fc`)를 암호화해 보관(`jwks`, OAuth 토큰 테이블 포함). 정기 백업은 정리 작업(매일 03:17) 뒤, 근무 시작(08:30) 전에 돌려 전날 활동 보고가 백업에 남지 않게 합니다 |
| 활동·상태 정리 | worker의 보존 기간 정리(매일 03:17)가 전날 이전의 활동 보고(`activity_reports`)와 기한이 지난 '내 상태'를 지웁니다. 따로 할 일 없음                                                                                                  |
| 커넥터 문제    | 직원: Claude 설정에서 ENU Den 해제 후 다시 연결 / ENU Den `/me`에서 연결 해제 후 재연결                                                                                                                                              |

## 5. 릴리스: ENU Den 전환

이름 변경(호스트 `den.enu-tech.co.kr`, 새 DB, 커넥터 재등록, 플러그인 `enu-den`)은 메신저 릴리스와 한 번에
진행합니다. 순서와 되돌리기는 [이름 변경 컷오버 런북](runbooks/rename-enu-den.ko.md)을 따릅니다. 이전 이름은 그
런북에만 적습니다.

## 6. 릴리스: 2026-11 타운 시각화 (마이그레이션 `0002`)

`0002_town_visualization`은 데이터를 지우는 마이그레이션입니다. 예전 거리 기반 채팅 기록, 채팅 수신자 목록
(`chat_message_recipients`), 저장된 접속 위치(`user_presence`), 채팅의 구역 정보(`chat_messages.zone_id`)를 삭제합니다.
`docker compose up`은 옛 `web`/`realtime`/`worker`가 아직 떠 있는 동안 `migrate`를 돌릴 수 있고, 옛 코드는 지워질 테이블을
읽으므로 아래 순서를 지킵니다. 타운이 잠시 꺼지니 직원에게 미리 알립니다.

0. 옛 이미지를 되돌리기용 태그로 남기고 새 이미지를 빌드합니다(아직 실행하지 않음).
   ```bash
   for s in web realtime worker; do docker tag enu-den/$s:latest enu-den/$s:rollback; done
   git pull && docker compose build
   ```
1. `docker compose stop web realtime worker`
2. 데이터베이스를 백업하고(`pg_dump -Fc`), 덤프를 이 릴리스와 함께 보관합니다.
   ```bash
   deploy/scripts/backup.sh <age-recipient> ./backups/release-2026-11
   ```
3. 새 이미지로 마이그레이션: `docker compose run --rm migrate`
4. `docker compose up -d`

릴리스 후:

- 개인정보 고지가 버전 2026-11로 바뀌어 모든 직원이 다음 접속 때 다시 동의하고 **활동 공유**를 직접 고릅니다
  (미리 골라 둔 값 없음, 고르지 않으면 꺼짐). 동의 전에는 타운에 들어올 수 없습니다(`notice_required` → `/welcome`).
- 조직 플러그인 마켓플레이스의 `enu-den` 플러그인을 이 저장소의 `claude/` 내용으로 갱신합니다(체크인 스킬이
  `post_activity`를 씀). Enterprise는 역할마다 `post_activity`를 **항상 허용**에 추가합니다.
- 열려 있던 브라우저에는 "ENU Den이 새 버전으로 바뀌었어요" 안내가 뜨고 새로고침됩니다. 예전 탭이 멈춰 있으면
  직접 새로고침하도록 안내합니다.

**되돌리기 = 2단계 백업 복원 + 옛 이미지.** 3단계 이후에는 이미지만 되돌릴 수 없습니다(`0002`가 테이블을 지워 옛
코드가 읽을 테이블이 없음). 백업 이후에 쓰인 데이터(업무 로그·채팅 등)는 사라집니다. 복원 전에 지금 상태도
`backup.sh`로 한 번 더 남겨 두면 원인 분석에 씁니다.

```bash
docker compose stop web realtime worker
docker compose exec -T postgres sh -c 'dropdb -U "$POSTGRES_USER" --force "$POSTGRES_DB" && createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
age -d -i <age-identity-file> ./backups/release-2026-11/enu-den-<stamp>.dump.age \
  | docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
for s in web realtime worker; do docker tag enu-den/$s:rollback enu-den/$s:latest; done
docker compose up -d
```

## 7. 문제 해결

관리자 화면에는 다른 사람의 상태·일정·활동이 없습니다(설계상, 관리자도 동료와 같은 화면만 봅니다).
타운 표시 문제는 **본인에게** 아래를 확인해 달라고 부탁합니다.

| 증상                                  | 확인                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 누군가 보이거나 보이지 않아요         | ① 직접 정한 상태와 언제까지(`자리 비움`이면 숨음, 다른 상태면 보임) ② 내 상태 메뉴의 "오늘 Claude가 보낸 일정"(회의·집중이면 보임, 부재면 숨음) ③ `/me` > 설정 > 활동 공유(꺼져 있으면 Claude가 보낸 일정·활동은 쓰지 않음) ④ `/me` > 설정 > 접속 표시(꺼져 있으면 타운을 열어도 보이지 않음). Claude의 '지금 하는 일'과 업무 로그는 이름표만 붙이고 아바타를 나타나게 하지 않습니다. 근무 시간(평일 08:30–19:30) 밖에는 아무도 보이지 않습니다 |
| 회의인데 회의 테이블에 모이지 않아요  | 참석자 **3명 이상**이 모두 활동 공유를 켰고, 각자의 Claude가 같은 `gcal:<iCalUID>`를 보냈어야 합니다. 1:1은 묶지 않습니다. 같은 시간에 회의가 둘이면 큰 쪽만 테이블에 앉고, 나머지는 자리에서 헤드셋 아이콘으로 보입니다. 파일럿 체크리스트의 `iCalUID` 항목 참고                                                                                                                                                                               |
| 동료 펫에 "…"이 안 보여요             | 정상입니다. 펫 말풍선은 본인만 보고, 동료에게는 말풍선이 떠 있다는 "…" 표시도 보내지 않습니다(탭을 보고 있는 시각이 드러나지 않도록). 근무 시간 밖에는 본인에게도 말풍선이 뜨지 않습니다                                                                                                                                                                                                                                                        |
| 근무 시간 밖에 화면을 시험하고 싶어요 | realtime의 `TOWN_IGNORE_OFFICE_HOURS=true`는 **개발·e2e 전용**입니다. 운영(`NODE_ENV=production`)에서는 부팅을 거부합니다(`NUDGE_IGNORE_QUIET_HOURS`와 같음)                                                                                                                                                                                                                                                                                    |

## 8. 자주 묻는 질문 (관리자)

- **"언제 왔는지 볼 수 있나요?"** → 아니요. 설계상 출퇴근·접속·위치·상태의 이력이나 근태 보고서는 없습니다.
  활동 보고는 그날 것만 있고 다음 날 새벽에 지워지며, 감사 기록에는 도구 호출 시각만 남고 활동 내용은 남지 않습니다.
  서버 로그에도 사용자별 접속 기록을 남기지 않습니다.
- **관리자는 더 볼 수 있나요?** 아니요. 관리자도 근무 시간에 동료와 같은 화면만 봅니다.
- **이런 기능을 추가할 수 있나요?** 근태 보고서, 접속·활동 이력, 관리자용 활동 화면은 새 ADR과 인사 검토 없이는
  만들지 않습니다([ADR 0004](adr/0004-town-is-a-visualization.md)).
