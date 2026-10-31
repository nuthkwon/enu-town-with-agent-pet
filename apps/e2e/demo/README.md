# 시연 동영상 만들기 (apps/e2e/demo)

ENU Den의 사용 시연 동영상(약 6분, 1920×1080, H.264), 마법 사무소 시연(약 4분, 효과음 포함), 그리고 게임 소개 페이지에
올릴 만한 게임플레이 트레일러(약 1분, 비트에 맞춘 컷·클로즈업·콜아웃, 합성 음악)를 자동으로 만듭니다. 예시 명단의 가명 직원들이
펫을 만들고 관리하며, 각자의 Claude(Claude Code 펫 채널, Cowork 예약 체크인)와 함께 CSMS 업무를 처리하는
장면입니다. 업무 내용은 예시이고, 펫의 답은 시나리오에 적힌 "그 직원의 Claude가 쓴 글"을 그대로 재생합니다.
ENU Den 서버는 답을 쓰지 않습니다.

CI에서는 돌지 않습니다. 실제 운영 데이터나 실명을 넣지 마세요(가명 명단 `config/seats.example.json`만 씁니다).

## 준비물

- 이 저장소의 개발 환경(`pnpm install`), Postgres 16 바이너리(`/usr/lib/postgresql/16/bin`), `ffmpeg`(libx264, libass)
- 한글 글꼴: `fonts-noto-cjk` (자막과 화면 글꼴)
- 선택: `faketime`(libfaketime). 있으면 실제 시각과 관계없이 근무 시간 아침으로 녹화합니다.
- `stack.sh`는 별도 Postgres 클러스터를 `postgres` 사용자로 띄우므로 root 권한이 필요합니다(개발 컨테이너 기준).

## 순서

```bash
# 1. 시연용 서버 (새 DB, 예시 명단, :3200 / :2767). DEMO_CLOCK은 근무일 아침 시각(Asia/Seoul).
DEMO_CLOCK=09:50 bash apps/e2e/demo/stack.sh

# 2. 녹화 → demo-output/enu-den-demo.mp4 (raw.mp4, captions.ass도 남음)
E2E_WEB_PORT=3200 pnpm --filter @enu/e2e demo

# 2-1. 마법 사무소 시연(약 4분, 효과음과 배경음 포함) → demo-output/enu-den-effects.mp4
#      (effects-raw.mp4, effects-captions.ass, mix.wav, verify/ 의 프레임·파형도 남음)
E2E_WEB_PORT=3200 pnpm --filter @enu/e2e demo:effects

# 2-2. 게임플레이 트레일러: 촬영(타운 960×720 줌 1, 타운 시계는 절반 속도 + 펫 방 2배 밀도, 순간마다 시각·위치 기록) 후 편집
#      DEMO_QUIET_DESKS=1로 띄운 새 스택에서 촬영하면 책상 명패가 이름만 보여 화면이 깔끔합니다.
bash apps/e2e/demo/stack.sh stop && DEMO_CLOCK=09:50 DEMO_QUIET_DESKS=1 bash apps/e2e/demo/stack.sh
E2E_WEB_PORT=3200 pnpm --filter @enu/e2e demo:trailer       # → demo-output/trailer/capture-*.mp4, moments.json, taps.json
pnpm --filter @enu/e2e demo:trailer:edit                    # → demo-output/trailer/enu-den-trailer.mp4 (+ verify/sheet-*.png)

# 3. 정리
bash apps/e2e/demo/stack.sh stop
```

### 트레일러 편집 (`demo/trailer/`)

- 장면 순서는 `trailer/storyboard.json`(샷마다 순간·박자 수·프레이밍·속도·히트스톱·전환·콜아웃)에 있습니다. 편집만
  다시 하려면 이 파일을 고치고 `demo:trailer:edit`만 다시 돌리면 됩니다(촬영은 그대로).
- 템포는 30fps에서 한 박이 정수 프레임이 되도록 맞춥니다(120, 128.57, 138.46 BPM). 컷은 박자에 정확히 떨어지고,
  이펙트가 터지는 프레임(장면의 이펙트 카운터에서 읽은 시각)이 박자 위에 오도록 샷을 고릅니다.
- 화면은 정수 배율 최근접 확대만 씁니다(픽셀 아트가 흐려지지 않게). 타운: 와이드 ×2, 미디엄 ×4, 클로즈 ×5,
  익스트림 ×6. 펫 방: ×2, ×3.
- 소프트웨어로 그리는 캔버스는 초당 15장 남짓이라, 촬영하는 동안만 그 화면의 게임 시계(`performance.now`와 프레임 시계)를
  절반 속도로 돌립니다. 편집에서 두 배로 재생하므로 이펙트마다 프레임이 두 배가 됩니다(서버·소리·제한은 실제 시간 그대로).
- 다음 동작의 메뉴가 열리기 전에 샷이 끝나도록 고르고, 그럴 수 없는 테이크는 건너뜁니다.
- 글자는 Galmuri BDF 비트맵을 픽셀 단위로 그립니다. 숫자·점수·횟수는 넣지 않습니다(콤보와 단체 응원은 그 순간의
  연출일 뿐). 타이틀 카드는 `@enu/sprites`의 실제 마법사·사역마 스프라이트와 `@enu/fx` 스트립으로 그립니다.
- 소리는 화면 속 직원07의 화면이 실제로 낸 효과음만, 그 샷이 놓인 자리로 옮겨 씁니다. 음악(`trailer/music.ts`)은
  코드로 합성합니다(D 장조, 드롭마다 라이저와 임팩트, 큰 타격에 맞춘 임팩트). 전체 약 −14 LUFS, 피크 −2 dBFS 아래.

`faketime`이 없으면 실제 시각으로 돌기 때문에 근무 시간(평일 08:30–19:30) 안에 녹화해야 커넥터 답장·타운
표시가 동작합니다.

## 구성

| 파일              | 역할                                                                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `csms.demo.ts`    | 시나리오(장면 순서, 자막, 펫의 답). 업무 내용을 바꾸려면 이 파일의 `ASK`, `CLAUDE_CODE`를 고칩니다                                                                                                           |
| `channel.ts`      | 직원 PC의 `enu-den-channel` 플러그인 대역: 페어링 코드로 연결하고 롱폴링으로 메시지를 받아 답함                                                                                                              |
| `overlay.ts`      | 화면 위 소품: 마우스 포인터, 제목 카드, 직접 입력하는 터미널 창                                                                                                                                              |
| `captions.ts`     | 자막(ASS). 앱 아래 80px 띠에 "누구의 화면인지 + 설명"을 넣음                                                                                                                                                 |
| `recorder.ts`     | Chromium 스크린캐스트 프레임을 ffmpeg로 30fps H.264 녹화                                                                                                                                                     |
| `stack.sh`        | 시연용 Postgres·web·realtime 실행(선택적으로 시계를 근무 시간으로 옮김)                                                                                                                                      |
| `effects.demo.ts` | 마법 사무소 시나리오(ADR 0008): 마법, 오라, 콤보·결계·단체 응원, 사역마, 퀘스트, 부화, 설정                                                                                                                  |
| `audio.ts`        | 소리: 녹화하는 화면이 실제로 낸 효과음의 시각을 받아(`__enuSfxTap`) 같은 레시피를 그 시각에 섞음(효과음 −16 LUFS). 합성한 잔잔한 배경음은 그보다 14 LU 낮게 깔리고 효과음이 나면 줄어듦. 피크는 −2 dBFS 아래 |
| `verify.ts`       | 완성본 검사: H.264·AAC, 통합 라우드니스와 트루 피크, 장면 프레임과 파형 그림(눈으로 확인)                                                                                                                    |
| `colleagues.ts`   | 가명 동료 창(작은 메신저 창, 타운 캔버스 없음): 로그인, 등장, 상태, 마법 쓰기                                                                                                                                |
| `trailer.demo.ts` | 트레일러 촬영: 크롬을 숨긴 타운(960×540, 줌 1)에서 동료들이 각자 화면으로 마법·출입·회의, 이어서 펫 방(2배 밀도). 순간마다 시각·이펙트가 터진 프레임·화면 위치를 `moments.json`에 기록                       |
| `trailer/`        | 트레일러 편집: `storyboard.json`, `edit.ts`(박자 격자·샷 계획), `render.ts`(ffmpeg 컷·크롭·히트스톱·콜아웃·믹스), `music.ts`(합성 음악), `title.ts`(픽셀 타이틀), `pixelfont.ts`(Galmuri BDF), `build.ts`    |
