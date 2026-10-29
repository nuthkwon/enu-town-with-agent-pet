# enu-town 플러그인

ENU Town(대덕비즈센터 A동 606호 사내 메타버스)에서 각자의 펫이 보여 주는 할 일 점검 문구와,
동료가 볼 수 있는 "지금 하는 일"(업무 로그)은 **본인의 Claude가 이 플러그인의 스킬로 작성**합니다.

- `enu-town-checkin` — 예약 작업(Cowork) 또는 직접 요청으로 실행되는 체크인 절차.
  `get_my_context` → `post_work_log` → `upsert_todos` → `post_pet_nudges`
- `enu-town-setup` — 처음 쓰는 사람을 위한 연결 확인·예약 작업 만들기 안내.

이 플러그인에는 MCP 서버 설정(`.mcp.json`)이 **없습니다**. ENU Town 커넥터는 조직 Owner가 조직 커스텀 커넥터로
한 번 등록하고, 각 직원이 Claude 설정에서 Connect합니다(이중 인증 방지). 자세한 내용은
`docs/admin-runbook.ko.md`, `docs/employee-onboarding.ko.md`를 보세요.
