import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, ROOT, devEmail } from '../env';
import { devLogin, userIdOf } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';
import { Captions, VIDEO } from './captions';
import { FakeClaudeCode, pairChannel, type ScriptedReply } from './channel';
import {
  glideClick,
  glideTo,
  hideCard,
  hideTerminal,
  installOverlay,
  showCard,
  terminal,
  typeInto,
} from './overlay';
import { startRecording } from './recorder';

/**
 * Demo video: one working morning of the CSMS (사이버보안 관리체계) team in ENU Den, played by the example
 * roster's pseudonyms. Every pet answer below is what that employee's own Claude writes (through the Claude
 * Code pet channel or a scheduled check-in); the demo only plays those parts. The CSMS tasks are an example.
 *
 * Run against a demo stack (see demo/README.md): `pnpm --filter @enu/e2e demo`. Output: demo-output/.
 */

const OUT = process.env.DEMO_OUT ?? path.join(ROOT, 'demo-output');
const CAST = {
  lead: { desk: 'R2b', name: '직원07', label: '직원07 · 개발팀 (CSMS 담당)' },
  qa: { desk: 'L2a', name: '직원04', label: '직원04 · 품질보증팀' },
  dev: { desk: 'L4a', name: '직원11', label: '직원11 · 개발팀' },
  boss: { desk: 'R1', name: '직원03', label: '직원03 · 경영' },
} as const;
/** Colleagues who simply have ENU Den open in the background (so the town is lived in). */
const EXTRAS = ['L1a', 'L1b', 'L2b', 'R2a', 'L3b', 'R3b', 'L4b', 'L5a'];

const PET = {
  name: '보안이',
  species: '고슴도치',
  tint: '라일락',
  role: 'CSMS(사이버보안 관리체계) 업무 도우미야. 할 일은 짧은 목록으로, 근거 문서 이름을 함께 알려 줘.',
  roleMore: ' 회의 전에는 우선순위부터 말해 줘.',
};

const ASK = {
  plan: '오늘 CSMS 할 일 정리해 줘. 10시 주간 점검 회의 전에 끝낼 것부터.',
  cve: 'CVE 2건 영향도 1차 판단 결과 요약해 줘',
  pii: '공급사 보안 담당자(010-2345-6789)에게 CIA 회신 요청할 것 메모해 줘',
  qa: 'CSMS 심사 증적 목록에서 아직 빠진 항목 있어?',
};

/** 직원07's Claude Code, answering through the pet channel (verbatim; ENU Den never writes these). */
const CLAUDE_CODE: ScriptedReply[] = [
  {
    match: '오늘 CSMS 할 일',
    thinkMs: 5200,
    parts: [
      '오늘 CSMS 할 일을 회의 전·후로 나눴어요.\n' +
        '회의 전\n' +
        '1. TARA 갱신: OTA 업데이트 기능 위협 시나리오 3건 반영 확인 (TARA 시트 v7)\n' +
        '2. 취약점 모니터링: 오픈소스 CVE 2건 영향도 1차 판단 (SBOM 2026-10)\n' +
        '회의 후\n' +
        '3. 사고 대응 절차서 개정안 검토 의견 정리\n' +
        '4. 공급사 CIA(사이버보안 인터페이스 합의서) 회신 항목 확인\n' +
        '5. CSMS 심사 증적 목록 업데이트',
      '1·2번 결과는 회의 자료용으로 한 장에 요약해 둘게요.',
    ],
  },
  {
    match: 'CVE 2건',
    thinkMs: 6500,
    parts: [
      'CVE 2건 1차 판단이에요.\n' +
        '① 압축 라이브러리 CVE: 취약 함수를 호출하는 경로가 없어 영향 낮음 (근거: 의존성 분석표 v3)\n' +
        '② TLS 라이브러리 CVE: 텔레매틱스 모듈에서 사용 중이라 영향 높음. 패치 버전 적용과 공급사 확인이 필요해요.\n' +
        '②는 TARA 위협 시나리오 TS-12에 연결해 두는 게 좋겠어요.',
    ],
  },
  {
    match: 'CIA 회신',
    thinkMs: 3800,
    parts: [
      '메모했어요. 회의가 끝나면 CIA 회신 요청 항목(패치 일정, 취약점 통지 기한)과 함께 다시 알려 드릴게요.',
    ],
  },
];

let clockOffsetMs = 0;

async function shifted(page: Page): Promise<void> {
  if (clockOffsetMs) await page.clock.setSystemTime(new Date(Date.now() + clockOffsetMs));
}

/** Switches the recorded browser to another person (dev login replaces the session cookie). */
async function loginAs(ctx: BrowserContext, desk: string): Promise<void> {
  const res = await ctx.request.post(`${BASE_URL}/api/auth/dev/login`, {
    headers: { origin: BASE_URL, 'content-type': 'application/json' },
    data: { email: devEmail(desk) },
  });
  expect(res.status(), await res.text()).toBe(200);
}

async function backgroundPage(browser: Browser, desk: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await devLogin(ctx, devEmail(desk));
  const page = await ctx.newPage();
  await shifted(page);
  await page.goto('/all');
  return ctx;
}

async function api(ctx: BrowserContext, method: 'GET' | 'POST' | 'PATCH', url: string, data?: unknown) {
  const res = await ctx.request.fetch(`${BASE_URL}${url}`, {
    method,
    headers: { origin: BASE_URL },
    ...(data === undefined ? {} : { data }),
  });
  expect(res.status(), `${method} ${url}: ${await res.text()}`).toBeLessThan(300);
  return res.status() === 204 ? null : res.json();
}

/** One meeting block shared by everyone who attends (same calendar id on each person's own calendar). */
function meetingBlock(serverNow: number) {
  const start = new Date(Math.floor((serverNow - 60_000) / 60_000) * 60_000);
  return {
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + 40 * 60_000).toISOString(),
    kind: 'meeting' as const,
    ref: 'gcal:csms-weekly-review@enu-tech.co.kr',
  };
}

test('ENU Den demo: a CSMS morning with pets and Claude', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });

  // The demo stack may run on a shifted clock (office hours whatever the real time): follow the server.
  const health = await fetch(`${BASE_URL}/api/healthz`);
  clockOffsetMs = new Date(health.headers.get('date') ?? Date.now()).getTime() - Date.now();
  if (Math.abs(clockOffsetMs) < 120_000) clockOffsetMs = 0;
  const serverNow = () => Date.now() + clockOffsetMs;

  /* ---------------------------------------------------------------- pre-roll (not recorded) */
  const people: Record<string, BrowserContext> = {};
  for (const [key, who] of Object.entries(CAST)) {
    people[key] = await browser.newContext();
    await devLogin(people[key]!, devEmail(who.desk));
  }
  const leadId = await userIdOf(people.lead!);

  // Each person's own Claude (Cowork) is connected through the consent screen.
  const claude = {
    lead: await mcpClient((await connectClaude(people.lead!)).token),
    qa: await mcpClient((await connectClaude(people.qa!)).token),
    dev: await mcpClient((await connectClaude(people.dev!)).token),
  };
  // What each Claude reported at its 9시 check-in (only labels the avatar or desk plate).
  await claude.lead.callTool({
    name: 'post_activity',
    arguments: { now: { kind: 'docs', ref: 'doc:csms-tara-v7' } },
  });
  await claude.qa.callTool({
    name: 'post_activity',
    arguments: { now: { kind: 'review', ref: 'doc:csms-evidence' } },
  });
  await claude.dev.callTool({
    name: 'post_activity',
    arguments: { now: { kind: 'work', ref: 'jira:CSMS-42' } },
  });
  // 직원07 already keeps a code-review pet (so the new one can be reordered).
  const pets = (await api(people.lead!, 'GET', '/api/v1/me/pets')) as { name: string }[];
  if (!pets.some((p) => p.name === '리뷰')) {
    await api(people.lead!, 'POST', '/api/v1/me/pets', {
      name: '리뷰',
      species: 'frog',
      tint: 'mint',
      role_instructions: '코드 리뷰를 꼼꼼하게 도와줘.',
      reply_route: 'both',
      default_visibility: null,
    });
  }
  const extras = await Promise.all(EXTRAS.map((d) => backgroundPage(browser, d)));
  const bgQa = await backgroundPage(browser, CAST.qa.desk);
  const bgDev = await backgroundPage(browser, CAST.dev.desk);

  // The recorded screen. The app gets 1920×1000; the band below carries the captions.
  const rec = await browser.newContext({
    viewport: { width: VIDEO.width, height: VIDEO.appHeight },
    bypassCSP: true,
  });
  await installOverlay(rec);
  await devLogin(rec, devEmail(CAST.lead.desk));
  const page = await rec.newPage();
  await shifted(page);
  // Warm up every route this demo opens (next dev compiles on first use), off camera.
  for (const url of ['/', '/pets/new', '/settings/pets', '/all', `/people/${leadId}`, '/town', '/privacy']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  await page.goto('/privacy');
  await showCard(page, 'ENU Den 사용 시연', [
    '펫과 함께하는 CSMS 업무의 아침',
    '~ 등장인물은 모두 가명이고, 업무 내용은 예시입니다.',
    '~ 펫의 답은 ENU Den이 아니라 각 직원 본인의 Claude가 씁니다.',
  ]);

  const video = await startRecording(page, path.join(OUT, 'raw.mp4'));
  const cc = new Captions(() => video.elapsed());
  /** Opens a page off camera (full loads fetch the town map again) and resumes once it is ready. */
  const openOffCamera = async (url: string, beforeLoad?: () => Promise<void>) => {
    video.pause();
    await beforeLoad?.();
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const town = page.getByRole('complementary', { name: '타운' });
    if (await town.count()) await expect(town.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    if (url === '/town') await expect(page.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    // The realtime session connects once the map is in.
    await page.waitForTimeout(2500);
    video.resume();
  };
  const pause = (ms: number) => page.waitForTimeout(ms);
  const composer = (petName: string) => page.getByRole('textbox', { name: `${petName}에게 메시지 보내기` });
  const nav = page.getByRole('navigation', { name: '대화 목록' });
  let channel: FakeClaudeCode | null = null;

  try {
    /* -------------------------------------------------------------- 0. title */
    cc.say('ENU Den: 나와 펫의 대화, 그리고 팀이 함께 보는 타운');
    await pause(4500);
    await showCard(page, '오늘의 CSMS 업무 (예시)', [
      '- TARA 갱신: OTA 업데이트 기능 위협 시나리오 반영',
      '- 오픈소스 취약점(CVE) 2건 영향도 1차 판단',
      '- 사고 대응 절차서 개정안 검토',
      '- 공급사 CIA(사이버보안 인터페이스 합의서) 회신 확인',
      '- CSMS 심사 증적 목록 정리 · 10시 주간 점검 회의',
    ]);
    cc.say('오늘 처리할 CSMS 업무를 직원07과 펫, 그리고 동료들과 함께 진행해 볼게요.');
    await pause(5500);

    /* -------------------------------------------------------------- 1. opening ENU Den */
    cc.as(CAST.lead.label);
    await openOffCamera('/', () => hideCard(page));
    await expect(page).toHaveURL(/\/pets\//);
    cc.say('ENU Den을 열면 내 대표 펫과의 대화방이 먼저 열려요.');
    await pause(3500);
    await glideTo(page, nav.getByRole('heading', { name: '내 펫' }), 60, 40);
    cc.say('왼쪽은 내 펫들과 대화방, 동료 목록이에요.');
    await pause(3200);
    await glideTo(page, page.getByRole('complementary', { name: '타운' }), 0, 40);
    cc.say('오른쪽 타운은 아무도 조작하지 않아요. 각자의 상태와 Claude가 보낸 일정으로 그려져요.');
    await pause(4500);

    /* -------------------------------------------------------------- 2. a new pet */
    cc.say('CSMS 업무만 맡길 펫을 새로 만들어 볼게요. 펫은 한 사람당 5마리까지예요.');
    await glideClick(page, nav.getByRole('link', { name: '새 펫 만들기' }));
    await expect(page).toHaveURL(/\/pets\/new$/);
    await pause(1500);
    await typeInto(page, page.locator('#pet-name'), PET.name, 160);
    await pause(700);
    await glideClick(page, page.getByRole('button', { name: '다음' }));
    cc.say('모습은 16종 동물과 색 중에서 골라요. 보안 담당이니 고슴도치로!');
    await pause(1200);
    await glideClick(page, page.locator('button[aria-pressed]', { hasText: PET.species }));
    await pause(900);
    await glideClick(page, page.locator('button[aria-pressed]', { hasText: PET.tint }));
    await pause(1400);
    await glideClick(page, page.getByRole('button', { name: '다음' }));
    cc.say('역할 지시문은 말투와 담당만 정해요. 나와 내 Claude만 볼 수 있어요.');
    await typeInto(page, page.locator('#pet-role'), PET.role, 38);
    await pause(1500);
    await glideClick(page, page.getByRole('button', { name: '다음' }));
    cc.say('답하는 방법: 내 PC의 Claude Code(바로)와 근무 시간 체크인 모두.');
    await glideTo(page, page.locator('#pet-route'));
    await pause(3200);
    await glideClick(page, page.getByRole('button', { name: '다음' }));
    cc.say('펫 대화는 기본 전사 공개예요. 동료에게는 날짜만 보이고 시간은 안 보여요.');
    await page.locator('#pet-visibility').selectOption('company');
    await glideTo(page, page.locator('#pet-visibility'));
    await pause(3400);
    await glideClick(page, page.getByRole('button', { name: '만들기' }));
    await expect(page.getByRole('heading', { level: 1, name: PET.name })).toBeVisible();
    const petId = page.url().split('/').pop()!;
    cc.say('보안이의 대화방이 생겼어요. 타운에서도 내 아바타를 따라다녀요.');
    await pause(4000);

    /* -------------------------------------------------------------- 3. managing pets + the channel */
    cc.say('펫 관리에서는 순서, 이름·역할, 답하는 방법을 바꾸고 삭제할 수 있어요.');
    await glideClick(page, page.getByRole('link', { name: '펫 설정' }));
    await expect(page.getByRole('heading', { name: '펫 관리' })).toBeVisible();
    await pause(2500);
    cc.say('보안이를 위로 올려 볼게요. 대표 펫은 언제나 맨 위, 지울 수도 없어요.');
    await glideClick(page, page.getByRole('button', { name: '위로' }).last());
    await pause(2600);
    cc.say('역할 지시문도 언제든 고칠 수 있어요.');
    await glideClick(page, page.getByRole('button', { name: '수정' }).nth(1));
    const role = page.locator('#pet-role');
    await glideClick(page, role);
    await role.press('End');
    await role.pressSequentially(PET.roleMore, { delay: 45 });
    await pause(900);
    await glideClick(page, page.getByRole('button', { name: '저장' }));
    await pause(2200);

    cc.say('이제 내 PC의 Claude Code를 펫 채널로 연결해요. 연결 코드는 10분, 한 번만 쓸 수 있어요.');
    await glideClick(page, page.getByRole('button', { name: '연결 코드 만들기' }));
    const command =
      (await page.locator('code').filter({ hasText: 'enu-pet pair' }).first().textContent()) ?? '';
    const code = command.trim().split(' ').pop()!;
    await pause(2500);
    cc.say('연결은 사람만 해요. 내 터미널에서 직접 입력합니다.');
    const termTitle = '터미널 — 직원07의 MacBook';
    await terminal(page, termTitle, [`$ enu-pet pair ${code}`]);
    const token = await pairChannel(BASE_URL, code, '직원07의 MacBook');
    await terminal(page, termTitle, [
      `$ enu-pet pair ${code}`,
      'ENU Den 직원07 계정에 연결했어요. 이제 `enu-pet`으로 Claude Code를 시작하세요.',
      '$ cd ~/work/csms && enu-pet',
    ]);
    channel = new FakeClaudeCode(BASE_URL, token, CLAUDE_CODE);
    channel.start();
    await pause(1500);
    await terminal(page, termTitle, [
      `$ enu-pet pair ${code}`,
      'ENU Den 직원07 계정에 연결했어요. 이제 `enu-pet`으로 Claude Code를 시작하세요.',
      '$ cd ~/work/csms && enu-pet',
      '✻ Claude Code · 채널 enu-den-channel 연결됨 (ENU Den 직원07)',
      '  셸 명령·파일 수정·다른 커넥터 사용 전에는 여기서 먼저 확인을 받아요.',
    ]);
    cc.say('Claude Code는 셸 명령이나 파일 수정 전에 꼭 이 터미널에서 본인 확인을 받아요.');
    await pause(4500);
    await hideTerminal(page);
    await page.reload();
    await expect(page.getByText('직원07의 MacBook')).toBeVisible();
    await glideTo(page, page.getByText('직원07의 MacBook'));
    cc.say('연결된 컴퓨터가 보여요. 이제 내 Claude Code가 펫 대화를 듣고 있어요.');
    await pause(3500);

    /* -------------------------------------------------------------- 4. CSMS work with 보안이 */
    await glideClick(page, nav.getByRole('link', { name: new RegExp(PET.name) }));
    await expect(page.getByRole('heading', { level: 1, name: PET.name })).toBeVisible();
    cc.say('보안이에게 오늘 할 일을 물어볼게요.');
    await typeInto(page, composer(PET.name), ASK.plan, 70);
    await composer(PET.name).press('Enter');
    cc.say('메시지는 직원07의 PC에서 돌고 있는 Claude Code로 바로 전달돼요. 서버는 답을 쓰지 않아요.');
    await expect(page.locator('li[data-author="pet"]').first()).toBeVisible({ timeout: 30_000 });
    cc.say('Claude Code가 펫의 말투로 답했어요. 보안이도 말하는 표정으로 바뀌어요.');
    await pause(5000);
    await expect(page.locator('li[data-author="pet"]')).toHaveCount(2, { timeout: 20_000 });
    await pause(3000);

    await typeInto(page, composer(PET.name), ASK.cve, 70);
    await composer(PET.name).press('Enter');
    cc.say('이어서 취약점 2건의 영향도를 물어봐요.');
    await expect(page.locator('li[data-author="pet"]')).toHaveCount(3, { timeout: 30_000 });
    cc.say('답은 내 Claude가 쓴 그대로 보여요. ENU Den은 고쳐 쓰지 않아요.');
    await pause(6500);

    await typeInto(page, composer(PET.name), ASK.pii, 60);
    await composer(PET.name).press('Enter');
    await expect(page.getByText('개인정보가 있어 전사 공개로 보낼 수 없어요')).toBeVisible();
    cc.say('전화번호 같은 개인정보는 전사 공개로 보낼 수 없어요. 나만 보기로는 보낼 수 있어요.');
    await pause(3800);
    await glideClick(page, page.getByRole('button', { name: '나만 보기로 보내기' }));
    await expect(page.locator('li[data-author="pet"]')).toHaveCount(4, { timeout: 30_000 });
    cc.say('나만 보기로 보낸 질문의 답도 나만 볼 수 있어요.');
    await pause(4500);

    /* -------------------------------------------------------------- 5. a colleague's scheduled check-in */
    cc.as(CAST.qa.label);
    await loginAs(rec, CAST.qa.desk);
    await openOffCamera('/');
    await expect(page).toHaveURL(/\/pets\//);
    cc.say('품질보증팀 직원04는 Claude Code 없이 Cowork 예약 체크인만 써요.');
    await pause(3000);
    const qaPet = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
    await typeInto(page, composer(qaPet), ASK.qa, 70);
    await composer(qaPet).press('Enter');
    await expect(page.locator('[data-wait]')).toBeVisible();
    await glideTo(page, page.locator('[data-wait]'));
    cc.say('펫이 다음 체크인 때 답한다고 알려 줘요. (근무 시간에만 체크인이 답해요)');
    await pause(4000);
    cc.say('잠시 후, 직원04의 Claude가 예약 체크인을 실행해요.');
    const inbox = structured<{ pet_inbox?: { items: { message_id: string; owner_text: string }[] } }>(
      await claude.qa.callTool({ name: 'get_my_context', arguments: { include: ['pet_inbox'] } }),
    );
    const asked = inbox.pet_inbox?.items.find((m) => m.owner_text === ASK.qa);
    expect(asked, JSON.stringify(inbox)).toBeTruthy();
    await claude.qa.callTool({
      name: 'post_pet_reply',
      arguments: {
        replies: [
          {
            in_reply_to: asked!.message_id,
            text:
              '증적 목록 42개 중 3개가 비어 있어요.\n' +
              '1. 취약점 모니터링 주간 보고서(10월 4주차)\n' +
              '2. 공급사 CIA 서명본\n' +
              '3. 사고 대응 모의훈련 결과서\n' +
              '1번은 오늘 오후에 채울 수 있고, 2번은 직원07님의 공급사 회신을 기다려야 해요.',
          },
        ],
      },
    });
    await expect(page.locator('li[data-author="pet"]').filter({ hasText: '증적 목록 42개' })).toBeVisible({
      timeout: 20_000,
    });
    await claude.qa.callTool({
      name: 'post_work_log',
      arguments: {
        summary: 'CSMS 심사 증적 목록을 점검했습니다. 42개 중 3개가 남아 있어 담당과 기한을 정리했습니다.',
        tasks: [
          { title: 'CSMS 심사 증적 목록 점검', status: 'done', ref: 'doc:csms-evidence' },
          { title: '취약점 모니터링 주간 보고서 작성', status: 'in_progress' },
        ],
      },
    });
    await claude.qa.callTool({
      name: 'upsert_todos',
      arguments: {
        items: [
          {
            external_ref: 'csms:evidence:vuln-weekly',
            title: '취약점 모니터링 주간 보고서 작성',
            due_at: new Date(serverNow() + 5 * 3600_000).toISOString(),
            priority: 1,
          },
        ],
      },
    });
    cc.say('체크인 한 번으로 펫의 답, 오늘의 업무 로그, 할 일이 함께 기록돼요.');
    await page.reload();
    await pause(5500);

    /* -------------------------------------------------------------- 6. a colleague reads along */
    cc.as(CAST.boss.label);
    await loginAs(rec, CAST.boss.desk);
    await openOffCamera(`/people/${leadId}`);
    cc.say('경영 직원03이 직원07의 펫들을 봐요. 동료의 펫 대화방은 읽기 전용이에요.');
    await pause(3000);
    await glideClick(page, page.locator(`main a[href="/people/${leadId}/pets/${petId}"]`));
    await expect(page.getByRole('heading', { level: 1, name: new RegExp(PET.name) })).toBeVisible();
    await expect(page.getByText(ASK.plan)).toBeVisible();
    cc.say('전사 공개된 대화만 날짜와 함께 보여요. 시간·읽음·답 대기는 보이지 않아요.');
    await pause(5000);
    cc.say('나만 보기로 보낸 개인정보 메모와 그 답은 동료에게 보이지 않아요.');
    await page.getByRole('main').getByText('CVE 2건 1차 판단', { exact: false }).scrollIntoViewIfNeeded();
    await pause(4500);
    await glideClick(page, page.getByRole('main').getByRole('link', { name: '직원07', exact: true }));
    await glideClick(page, page.getByRole('link', { name: 'DM 보내기' }));
    const dm = page.getByRole('textbox', { name: '메시지를 입력하세요' });
    await typeInto(page, dm, 'CVE 정리 고마워요. 회의 때 TLS 패치 일정만 같이 봐요.', 65);
    await expect(page.getByRole('button', { name: '보내기' })).toBeEnabled({ timeout: 30_000 });
    await dm.press('Enter');
    cc.say('궁금한 건 바로 DM으로 물어봐요.');
    await pause(3500);

    /* -------------------------------------------------------------- 7. the town: bubbles and the meeting */
    cc.as(CAST.lead.label);
    await loginAs(rec, CAST.lead.desk);
    await claude.lead.callTool({
      name: 'post_pet_nudges',
      arguments: { nudges: [{ text: '회의 전에 TARA 변경 이력 한 번 더 확인해 볼까요?', priority: 1 }] },
    });
    await openOffCamera('/town');
    cc.say('타운 크게 보기. 내 펫들이 아바타를 따라다니고, 펫 말풍선은 나에게만 보여요.');
    await pause(7000);
    cc.say('10시, 세 사람의 Claude가 각자의 캘린더에서 같은 회의를 보고해요.');
    const block = meetingBlock(serverNow());
    for (const c of [claude.lead, claude.qa, claude.dev]) {
      await c.callTool({ name: 'post_activity', arguments: { now: null, schedule: [block] } });
    }
    await pause(3500);
    cc.say('셋이 회의 테이블에 모였어요. 서로 확인된 일정만 묶고, 아무도 아바타를 움직이지 않아요.');
    await pause(7000);

    /* -------------------------------------------------------------- 8. sharing the result */
    await openOffCamera('/all');
    cc.say('회의가 끝나고 전체 방에 결과를 공유해요.');
    const room = page.getByRole('textbox', { name: '메시지를 입력하세요' });
    await typeInto(
      page,
      room,
      'CSMS 주간 점검: TARA 위협 시나리오 3건 반영, CVE 1건 패치 필요(공급사 확인 중). 증적 3건은 내일까지 채웁니다.',
      40,
    );
    await expect(page.getByRole('button', { name: '보내기' })).toBeEnabled({ timeout: 30_000 });
    await room.press('Enter');
    await pause(3500);
    await claude.lead.callTool({
      name: 'post_work_log',
      arguments: {
        summary:
          'CSMS 주간 점검을 준비하고 진행했습니다. TARA에 OTA 위협 시나리오 3건을 반영했고, 오픈소스 CVE 2건 중 1건은 패치가 필요해 공급사에 확인을 요청할 예정입니다.',
        tasks: [
          { title: 'TARA 갱신 (OTA 위협 시나리오)', status: 'done', ref: 'doc:csms-tara-v7' },
          { title: 'CVE 2건 영향도 1차 판단', status: 'done' },
          { title: '공급사 CIA 회신 요청', status: 'planned' },
        ],
        source_hint: 'claude_code',
      },
    });
    await glideClick(page, nav.getByRole('link', { name: /모모/ }));
    cc.say('하루 동안 내 Claude가 남긴 업무 로그는 대화방과 타운의 자리 표시판에서 함께 보여요.');
    await pause(6500);

    await showCard(page, 'ENU Den', [
      '펫에게 묻고, 내 Claude가 답하고, 팀은 함께 봅니다.',
      '~ 서버는 답을 쓰지 않아요 · 동료에게는 날짜만 · 근무 시간에만 공유',
    ]);
    cc.clear();
    await pause(5000);
  } finally {
    await video.stop();
    await channel?.stop();
    cc.write(path.join(OUT, 'captions.ass'), video.elapsed() + 1);
    for (const c of Object.values(claude)) await c.close().catch(() => undefined);
    for (const ctx of [...extras, bgQa, bgDev, rec, ...Object.values(people)])
      await ctx.close().catch(() => undefined);
  }

  // Band for the captions under the app, then the captions themselves.
  const final = path.join(OUT, 'enu-den-demo.mp4');
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(OUT, 'raw.mp4'),
      '-vf',
      `pad=${VIDEO.width}:${VIDEO.height}:0:0:color=0x2d2640,subtitles=${path.join(OUT, 'captions.ass')}`,
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      final,
    ],
    { stdio: 'inherit' },
  );
  expect(ff.status).toBe(0);
});
