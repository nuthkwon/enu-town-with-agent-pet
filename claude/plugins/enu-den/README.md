# enu-den 플러그인

ENU Den(대덕비즈센터 A동 606호 사내 메신저·메타버스)에서 각자의 펫이 하는 답장과 할 일 점검 문구,
동료가 볼 수 있는 "지금 하는 일"(업무 로그)은 **본인의 Claude가 이 플러그인의 스킬로 작성**합니다.
타운의 아바타는 아무도 조작하지 않습니다. 본인이 정한 상태, 타운 접속, 본인 Claude가 보낸 캘린더 일정으로
ENU Den이 자리를 정하고, Claude가 보낸 '지금 하는 일'은 이름표로만 붙습니다.

- `enu-den-checkin` — 예약 작업(Cowork) 또는 직접 요청으로 실행되는 체크인 절차.
  ENU Den 도구 여섯 가지를 이 순서로 씁니다:
  `get_my_context` → `post_pet_reply` → `post_work_log` → `post_activity` → `upsert_todos` → `post_pet_nudges`
- `enu-den-setup` — 처음 쓰는 사람을 위한 연결 확인·예약 작업 만들기 안내.

`post_activity`(오늘 일정과 지금 하는 일)는 직원이 ENU Den `/me > 설정 > 활동 공유`를 직접 켠 경우에만 보냅니다.

이 플러그인에는 MCP 서버 설정(`.mcp.json`)이 **없습니다**. ENU Den 커넥터는 조직 Owner가 조직 커스텀 커넥터로
한 번 등록하고, 각 직원이 Claude 설정에서 Connect합니다(이중 인증 방지). 자세한 내용은
`docs/admin-runbook.ko.md`, `docs/employee-onboarding.ko.md`를 보세요.
