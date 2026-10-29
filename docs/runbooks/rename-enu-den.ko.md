# 이름 변경 컷오버: ENU Town → ENU Den

이 문서는 예전 이름(ENU Town, `enu-town`, `enu_town`, `town.enu-tech.co.kr`)을 적어도 되는 **유일한 문서**다.
다른 문서와 코드는 `scripts/verify-policy.sh` 규칙 5가 예전 이름을 막는다.

ENU Den 메신저 릴리스와 **한 번에** 전환한다(파일럿, 운영 데이터 보존 없음). 재동의·커넥터 재연결·예약 작업
교체를 직원에게 한 번만 요청하기 위해서다. 기능 쪽 절차(펫 채널, 6번째 도구, 개인정보 고지 `2026-12`)는
[관리자 런북](../admin-runbook.ko.md)의 릴리스 절을 함께 본다.

## 바뀌는 이름

| 항목             | 예전                                      | 새 이름                                 |
| ---------------- | ----------------------------------------- | --------------------------------------- |
| 제품             | ENU Town                                  | ENU Den                                 |
| 호스트           | `town.enu-tech.co.kr`                     | `den.enu-tech.co.kr`                    |
| 개발 호스트      | `town-dev.<domain>`                       | `den-dev.<domain>`                      |
| GitHub 레포      | `nuthkwon/enu-town-with-agent-pet`        | `nuthkwon/enu-den`                      |
| Claude 플러그인  | `enu-town` (`enu-town-checkin`, `-setup`) | `enu-den` (`enu-den-checkin`, `-setup`) |
| MCP 서버 이름    | `enu-town`                                | `enu-den`                               |
| DB               | `enu_town`, `enu_town_dev/_test/_e2e`     | `enu_den`, `enu_den_dev/_test/_e2e`     |
| NOTIFY 채널      | `enu_town_events`                         | `enu_den_events`                        |
| 실시간 티켓 aud  | `enu-town-realtime`                       | `enu-den-realtime`                      |
| Docker           | 프로젝트 `enu-town`, 이미지 `enu-town/*`  | 프로젝트 `enu-den`, 이미지 `enu-den/*`  |
| Cowork 예약 작업 | `ENU Town 체크인`                         | `ENU Den 체크인`                        |
| 커넥터           | `ENU Town`                                | `ENU Den`                               |

web, realtime, worker는 NOTIFY 채널·티켓 aud·잠금 키·활동 ref 키를 함께 바꾸므로 **섞어서 띄우지 않는다**.
compose로 전부 내리고 함께 올린다.

## T-7일

1. 14명에게 공지한다: 전환 시각(19:30 이후)과 직원이 할 일 네 가지(den 주소로 로그인, 첫 입장 설정·동의,
   커넥터 다시 연결, 예약 작업 교체).
2. DNS: `den.enu-tech.co.kr` A/AAAA 레코드를 같은 서버로 만들고(TTL 300) `dig`로 확인한다.
3. GCP OAuth 클라이언트:
   - 리디렉션 URI `https://den.enu-tech.co.kr/api/auth/callback/google`를 추가한다.
   - 동의 화면 앱 이름을 "ENU Den"으로 바꾼다. 클라이언트는 Internal·Trusted 그대로다.
4. GitHub:
   - 오너가 레포 이름을 바꾼다(Settings > General). GitHub가 예전 주소를 리디렉트하므로 예전 이름으로 새 레포를
     만들지 않는다.
   - 모든 클론: `git remote set-url origin https://github.com/nuthkwon/enu-den.git`
   - 예전 주소를 고정한 곳(Claude Code 웹 환경 등)을 바꾼다.

## T0, 서버 (근무 시간 후)

5. **예전 데이터 정리 후 백업한다.** 고지에서 "다음 날 지운다"고 약속한 데이터(오늘 활동 보고, 말풍선 표시 기록)와
   로그인 세션이 백업에 남지 않게 한다.
   ```bash
   docker compose -p enu-town exec postgres psql -U enu -d enu_town \
     -c 'TRUNCATE activity_reports, nudge_deliveries; DELETE FROM session;'
   COMPOSE_PROJECT_NAME=enu-town deploy/scripts/backup.sh <age-recipient> ./backups/pre-enu-den
   ```
6. 예전 스택을 내린다: `docker compose -p enu-town down` (볼륨은 롤백용으로 잠시 남는다).
7. 코드와 env를 바꾼다:
   - `git remote set-url …` 후 `git pull`
   - `.env`: `PUBLIC_HOST=den.enu-tech.co.kr`
   - `deploy/env/postgres.env`: `POSTGRES_DB=enu_den`
   - `web.env`: `PUBLIC_URL`, `REALTIME_PUBLIC_URL`, `DATABASE_URL=…/enu_den`
   - `realtime.env`: `ALLOWED_ORIGINS`, `DATABASE_URL`
   - `worker.env`: `DATABASE_URL`
   - 각 파일을 `*.env.example`과 `diff`로 비교한다. 예전 env 파일은 롤백용으로 따로 둔다.
8. 새 스택을 올린다(**새 DB**, D7):
   ```bash
   docker compose up -d --build                         # 프로젝트 enu-den, 새 볼륨, migrate 자동 실행
   docker compose run --rm migrate node dist/seed-seats.mjs
   ```
9. 확인한다:
   - `scripts/check-oauth-discovery.sh https://den.enu-tech.co.kr`
   - `curl -fsS https://den.enu-tech.co.kr/api/healthz`
   - `docker compose exec postgres psql -U enu -d enu_den -c "select application_name from pg_stat_activity where application_name like 'enu-%'"`
     에 enu-den-web, -realtime, -realtime-listen, -worker, -worker-boss가 보인다.
   - 관리자가 로그인하면 /welcome으로 간다.
10. (선택) 브라우저 전용 리디렉트 `town.enu-tech.co.kr { redir https://den.enu-tech.co.kr{uri} 308 }`를 서버 로컬
    Caddy 설정에만 2주간 둔다. 커밋하지 않고, `/api/mcp`에는 기대지 않는다.

## T0, Claude 조직 (오너)

되돌릴 수 없는 지점은 11번이다. 9번이 통과한 뒤에만 한다.

11. 커넥터: 조직 설정 > 커넥터에서 "ENU Town"을 지우고 커스텀 웹 커넥터를 추가한다.
    - 이름 "ENU Den", URL `https://den.enu-tech.co.kr/api/mcp`, 인증 "Use Claude's published identity"(CIMD)
    - Enterprise라면 새 커넥터의 모든 도구를 역할별로 **Always allow**로 둔다(예전 허용은 커넥터와 함께 사라진다).
12. 플러그인 마켓플레이스(`claude/`를 미러링하는 비공개 레포): `plugins/enu-town`을 `plugins/enu-den`으로 바꾸고,
    조직 설정에서 `enu-den`을 기본 설치/필수로, `enu-town`은 제거한다. `enu-den-channel`(펫 채널)은 **사용 가능**으로
    올리고, 쓰려면 조직의 Channels 기능을 켠다.
13. Claude Code 관리 설정: `claudeMd`와 `permissions.allow`를 새 서버 이름(`/mcp`에 보이는 이름)으로 다시 배포한다.
    펫 채널을 쓰면 `channelsEnabled`, `allowedChannelPlugins`, 채널 도구 허용과 자격증명 폴더 차단도 함께 배포한다
    (`claude/managed-settings/claude-code.managed.example.json`).
14. 첫 연결 뒤 `audit_events`에 `oauth.client_discovered`가 생기는지 본다.

## T+1 아침, 직원 (약 5분)

15. https://den.enu-tech.co.kr 에 Google로 로그인하고 /welcome을 마친다.
16. Claude 설정 > 커넥터 > **ENU Den** > 연결. 동의 화면에 본인 이메일이 보이는지 확인한다.
17. Cowork: 예약 작업 이름을 `ENU Den 체크인`으로 바꾸고 enu-den-setup의 새 프롬프트를 붙여 넣는다
    (또는 예전 작업을 지우고 "ENU Den 설정 도와줘"라고 말한다).
18. Claude Code 사용자: `/plugin`에서 `enu-den@enu-tech`을 설치하고 `enu-town`을 지운다. 서버를 직접 추가했다면
    `claude mcp remove enu-town` 후 `claude mcp add --transport http enu-den https://den.enu-tech.co.kr/api/mcp`.
19. "ENU Den 체크인 해줘"를 한 번 실행해 업무 로그가 보이는지 확인한다.
    - (선택) Claude Code 펫 채널: "ENU Den 설정 도와줘"의 안내대로 `enu-pet` 함수를 만들고, `펫 관리`에서 만든
      코드로 `enu-pet pair <코드>`를 직접 입력한다.

## 개발자

20. 로컬 DB 이름을 바꾼다(`pnpm dev`를 멈춘 뒤):
    ```bash
    psql -d postgres -c 'ALTER DATABASE enu_town_dev RENAME TO enu_den_dev'
    psql -d postgres -c 'ALTER DATABASE enu_town_test RENAME TO enu_den_test'
    psql -d postgres -c 'ALTER DATABASE enu_town_e2e RENAME TO enu_den_e2e'
    ```
    연결이 남아 있어 실패하면 `pg_terminate_backend`로 끊거나, DB를 새로 만들고 migrate와 seed를 다시 돌린다.
    `DATABASE_URL`, `DATABASE_URL_TEST`, `E2E_DATABASE_URL`도 바꾼다. compose.dev Postgres는 프로젝트 이름이 바뀌어
    새 볼륨이 생기므로 `createdb enu_den_test enu_den_e2e`를 다시 한다.
21. 개발 커넥터: "ENU Town (dev)"를 지우고 "ENU Den (dev)"를 `https://den-dev.<domain>/api/mcp`로 등록한다.

## 정리 (T+7 이내)

- `docker volume rm enu-town_pgdata enu-town_caddy_data enu-town_caddy_config`
- `docker image rm enu-town/{web,realtime,worker}:latest`
- 예전 DNS 레코드와 GCP 리디렉션 URI를 지운다.
- `pre-enu-den` 백업을 파기하고 날짜를 ADR 0004 "Review before rollout"에 적는다.

## 롤백 (11번 전까지만)

```bash
docker compose down
git checkout <이름 변경 전 태그>
# 예전 env 파일 복원
docker compose -p enu-town up -d
```

11번 뒤에는 예전 커넥터를 다시 등록하고 모두 다시 연결해야 한다.
