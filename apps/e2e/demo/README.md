# 시연 동영상 만들기 (apps/e2e/demo)

ENU Den의 사용 시연 동영상(약 5–6분, 1920×1080, H.264)을 자동으로 녹화합니다. 예시 명단의 가명 직원들이
펫을 만들고 관리하며, 각자의 Claude(Claude Code 펫 채널, Cowork 예약 체크인)와 함께 CSMS 업무를 처리하는
장면입니다. 업무 내용은 예시이고, 펫의 답은 시나리오에 적힌 "그 직원의 Claude가 쓴 글"을 그대로 재생합니다.
ENU Den 서버는 답을 쓰지 않습니다.

CI에서는 돌지 않습니다. 실제 운영 데이터나 실명을 넣지 마세요(가명 명단 `config/seats.example.json`만 씁니다).

## 준비물

- 이 저장소의 개발 환경(`pnpm install`), Postgres 16 바이너리(`/usr/lib/postgresql/16/bin`), `ffmpeg`(libx264, libass)
- 한글 글꼴: `fonts-noto-cjk` (자막과 화면 글꼴)
- 선택: `faketime`(libfaketime). 있으면 실제 시각과 관계없이 근무 시간 아침으로 녹화합니다.

## 순서

```bash
# 1. 시연용 서버 (새 DB, 예시 명단, :3200 / :2767). DEMO_CLOCK은 근무일 아침 시각(Asia/Seoul).
DEMO_CLOCK=09:46 bash apps/e2e/demo/stack.sh

# 2. 녹화 → demo-output/enu-den-demo.mp4 (raw.mp4, captions.ass도 남음)
E2E_WEB_PORT=3200 pnpm --filter @enu/e2e demo

# 3. 정리
bash apps/e2e/demo/stack.sh stop
```

`faketime`이 없으면 실제 시각으로 돌기 때문에 근무 시간(평일 08:30–19:30) 안에 녹화해야 커넥터 답장·타운
표시가 동작합니다.

## 구성

| 파일           | 역할                                                                                               |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `csms.demo.ts` | 시나리오(장면 순서, 자막, 펫의 답). 업무 내용을 바꾸려면 이 파일의 `ASK`, `CLAUDE_CODE`를 고칩니다 |
| `channel.ts`   | 직원 PC의 `enu-den-channel` 플러그인 대역: 페어링 코드로 연결하고 롱폴링으로 메시지를 받아 답함    |
| `overlay.ts`   | 화면 위 소품: 마우스 포인터, 제목 카드, 직접 입력하는 터미널 창                                    |
| `captions.ts`  | 자막(ASS). 앱 아래 80px 띠에 "누구의 화면인지 + 설명"을 넣음                                       |
| `recorder.ts`  | Chromium 스크린캐스트 프레임을 ffmpeg로 30fps H.264 녹화                                           |
| `stack.sh`     | 시연용 Postgres·web·realtime 실행(선택적으로 시계를 근무 시간으로 옮김)                            |
