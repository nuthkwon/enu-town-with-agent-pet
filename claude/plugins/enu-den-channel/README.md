# enu-den-channel 플러그인 (선택)

ENU Den 펫 대화방에 쓴 메시지를 **내 컴퓨터의 Claude Code 세션**이 바로 받아 펫으로 답하게 하는 Claude Code
채널입니다(ADR 0006). 설치하지 않아도 펫은 근무 시간의 체크인(ENU Den 커넥터)에서 답합니다.

- 서버는 이 플러그인 안의 `server/den-channel.mjs` 하나입니다(소스: `packages/pet-channel`, 생성 파일이니 직접
  고치지 마세요). 모델을 부르지 않고 ENU Den과 Claude Code 사이에서 메시지만 전달합니다.
- `enu-pet`으로 시작한 세션(`ENU_DEN_PET=1`)에서만 동작합니다. 다른 세션에서는 도구도 네트워크도 없고 자격 증명도
  읽지 않습니다.
- 연결(페어링)은 **사람이 터미널에서만** 합니다: ENU Den 설정에서 코드를 만들고 `enu-pet pair 코드`. 연결 도구는
  Claude에게 주지 않습니다. 토큰은 `~/.claude/channels/enu-den/credentials.json`(본인만 읽기)에 저장됩니다.
- Claude Code에 주는 도구는 `reply`(펫으로 답하기)와 `status`(연결 상태)뿐입니다. 셸 명령·파일 수정·다른 커넥터는
  펫 메시지 때문에 쓰기 전에 반드시 터미널에서 본인 확인을 받습니다.

설정 방법은 `enu-den` 플러그인의 `enu-den-setup` 스킬과 `docs/runbooks/dev-channel.md`를 보세요.
