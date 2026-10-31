import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { BASE_URL, ROOT, devEmail } from '../env';
import { devLogin, userIdOf } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';
import { fxStrips, railRow, setMyStatus, sfxPlayed, wakeSound } from '../support/town';
import { listenForSounds, muxAudio, type Tap } from './audio';
import { Captions, VIDEO } from './captions';
import { glideClick, glideTo, hideCard, installOverlay, showCard, typeInto } from './overlay';
import { startRecording, type Recording } from './recorder';
import { verifyVideo } from './verify';

/**
 * Demo video: ENU Den's wizard office (ADR 0008). Pseudonymous colleagues cast friendly spells, the town draws
 * their public statuses as auras, a familiar plays in its owner's pet room and a to-do becomes a quest. The sound
 * track is what the person on screen (직원07) heard: the same @enu/sfx recipes, mixed at the moments the page played
 * them, over a quiet synthesized bed. Pet replies are what 직원07's own Claude writes; ENU Den never writes them.
 *
 * Run against a demo stack (see demo/README.md): `pnpm --filter @enu/e2e demo:effects`. Output: demo-output/.
 */

const OUT = process.env.DEMO_OUT ?? path.join(ROOT, 'demo-output');
const ME = { desk: 'R2b', name: '직원07', label: '직원07 · 개발팀' };
/** Colleagues with the town open in the background (each casts from their own screen). */
const CAST = {
  dev: { desk: 'L4a', name: '직원11' },
  qa: { desk: 'L2a', name: '직원04' },
  pal: { desk: 'L5a', name: '직원13' },
  boss: { desk: 'R1', name: '직원03' },
  sec: { desk: 'L2b', name: '직원05' },
} as const;
/** Colleagues who just have the messenger open (so the town is lived in). */
const EXTRAS = ['L1a', 'L1b', 'L3b', 'R3b', 'L4b', 'R2a'];

const QUESTS = [
  { external_ref: 'demo:quest:review', title: 'PR 리뷰 2건 마무리', priority: 1 },
  { external_ref: 'demo:quest:release', title: '릴리스 노트 초안 쓰기', priority: 2 },
];
const ASK = '오늘 남은 퀘스트 알려 줘';
/** 직원07's Claude, answering through the connector (verbatim; ENU Den never writes this). */
const REPLY =
  '남은 퀘스트는 하나예요: 릴리스 노트 초안 쓰기. 오후 3시 전에 끝내면 리뷰 일정과 겹치지 않아요.';

let clockOffsetMs = 0;
async function shifted(page: Page): Promise<void> {
  if (clockOffsetMs) await page.clock.setSystemTime(new Date(Date.now() + clockOffsetMs));
}

interface Colleague {
  ctx: BrowserContext;
  page: Page;
  name: string;
  id: string;
}

/**
 * A colleague with ENU Den open in a small window: below 1280 px the messenger mounts no town canvas, so a dozen
 * colleagues cost the machine nothing while still being drawn in 직원07's town.
 */
async function colleague(browser: Browser, desk: string, name: string): Promise<Colleague> {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await devLogin(ctx, devEmail(desk));
  const id = await userIdOf(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(30_000);
  await shifted(page);
  await page.goto('/all');
  await expect(page.getByRole('navigation', { name: '대화 목록' })).toBeVisible({ timeout: 90_000 });
  return { ctx, page, name, id };
}

/** Sets a colleague's own status in the town's status menu (off camera), then back to the messenger. */
async function statusOf(c: Colleague, option: string, duration: string): Promise<void> {
  await c.page.goto('/town');
  await expect(c.page.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  await setMyStatus(c.page, option, duration);
  await c.page.goto('/all');
  await expect(c.page.getByRole('navigation', { name: '대화 목록' })).toBeVisible({ timeout: 90_000 });
}

/** Opens someone's page in a colleague's messenger (a client-side move: the session stays connected). */
async function openPerson(c: Colleague, to: { id: string; name: string }): Promise<void> {
  if (c.page.url().endsWith(`/people/${to.id}`)) return;
  await c.page
    .getByRole('navigation', { name: '대화 목록' })
    .getByRole('link', { name: new RegExp(`^${to.name}`) })
    .first()
    .click();
  await expect(c.page).toHaveURL(new RegExp(`/people/${to.id}$`));
}

/** A colleague casts from their own screen: the 마법 button on the target's page in the messenger. */
async function castFrom(from: Colleague, to: { id: string; name: string }, spell: string): Promise<void> {
  await openPerson(from, to);
  await from.page.getByRole('button', { name: /마법/ }).click();
  const button = from.page
    .getByRole('dialog', { name: `${to.name}님에게 마법 쓰기` })
    .getByRole('button', { name: spell });
  await expect(button).toBeEnabled({ timeout: 20_000 });
  await button.click();
}

test('ENU Den demo: the wizard office', async ({ browser }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(OUT, { recursive: true });

  const health = await fetch(`${BASE_URL}/api/healthz`);
  clockOffsetMs = new Date(health.headers.get('date') ?? Date.now()).getTime() - Date.now();
  if (Math.abs(clockOffsetMs) < 120_000) clockOffsetMs = 0;

  /* ---------------------------------------------------------------- pre-roll (not recorded) */
  const people = {
    dev: await colleague(browser, CAST.dev.desk, CAST.dev.name),
    qa: await colleague(browser, CAST.qa.desk, CAST.qa.name),
    pal: await colleague(browser, CAST.pal.desk, CAST.pal.name),
    boss: await colleague(browser, CAST.boss.desk, CAST.boss.name),
    sec: await colleague(browser, CAST.sec.desk, CAST.sec.name),
  };
  const extras = await Promise.all(EXTRAS.map((d) => colleague(browser, d, d)));
  // Their own statuses, already public: 직원04 focuses, 직원11 takes a break (the town draws them as auras).
  await statusOf(people.qa, '집중 모드', '1시간');
  await statusOf(people.dev, '휴식', '1시간');

  const rec = await browser.newContext({
    viewport: { width: VIDEO.width, height: VIDEO.appHeight },
    bypassCSP: true,
  });
  await installOverlay(rec);
  let video: Recording | null = null;
  const taps: Tap[] = await listenForSounds(rec, () => video);
  await devLogin(rec, devEmail(ME.desk));
  const me = { id: await userIdOf(rec), name: ME.name };
  const claude = await mcpClient((await connectClaude(rec)).token);
  const palClaude = await mcpClient((await connectClaude(people.pal.ctx)).token);
  await claude.callTool({ name: 'upsert_todos', arguments: { items: QUESTS } });
  const page = await rec.newPage();
  page.setDefaultTimeout(30_000);
  await shifted(page);
  for (const url of ['/', '/town', '/me?tab=settings', '/pets/new']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  await page.goto('/privacy');
  await showCard(page, 'ENU Den 마법 사무소', [
    '동료에게 거는 응원 마법, 사역마, 오늘의 퀘스트',
    '~ 등장인물은 모두 가명이에요. 이펙트와 효과음은 모두 코드로 만들었어요.',
    '~ 소리는 화면 속 직원07이 들은 소리만 담았어요.',
  ]);

  video = await startRecording(page, path.join(OUT, 'effects-raw.mp4'));
  const v = video;
  const cc = new Captions(() => v.elapsed());
  const moments: number[] = [];
  const mark = () => moments.push(v.elapsed() + 1.2);
  const pause = (ms: number) => page.waitForTimeout(ms);
  /** Opens a page off camera, waits for the town (when there is one) and wakes the page's sound. */
  const openOffCamera = async (url: string, before?: () => Promise<void>) => {
    v.pause();
    await before?.();
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
    const panel = page.getByRole('complementary', { name: '타운' });
    if (url === '/town') await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
    else if (await panel.count())
      await expect(panel.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
    await wakeSound(page);
    await page.mouse.move(-50, -50);
    await page.waitForTimeout(2500);
    v.resume();
  };
  const myMenuOn = async (name: string) => {
    await glideClick(page, railRow(page, name));
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    return menu;
  };
  const castMine = async (target: string, spell: string) => {
    const menu = await myMenuOn(target);
    const button = menu.getByRole('menuitem', { name: spell });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    await glideTo(page, menu.locator('[data-spell]').first());
    await pause(500);
    await glideClick(page, button);
  };
  /** Double-clicks someone's avatar: 이 사람 보기 (zoom 2, centred on them), the way a person looks closer. */
  const focusOn = async (userId: string) => {
    const box = await page.locator('canvas').first().boundingBox();
    const at = await page.evaluate((id) => window.__ENU_DEN_DEBUG__?.avatarScreen(id) ?? null, userId);
    if (!box || !at) return;
    await page.mouse.move(box.x + at.x, box.y + at.y, { steps: 26 });
    await pause(300);
    await page.mouse.dblclick(box.x + at.x, box.y + at.y);
    await pause(1200);
    await page.mouse.move(box.x + box.width - 40, box.y + box.height - 40, { steps: 18 });
  };
  const overview = async () => {
    const all = page.getByRole('button', { name: '전체 보기' });
    if (await all.isEnabled()) await glideClick(page, all);
  };

  try {
    /* -------------------------------------------------------------- 0. title */
    cc.say('ENU Den이 마법 사무소가 되었어요. 게임 속 스킬처럼, 그러나 사무실답게.');
    await pause(5000);

    /* -------------------------------------------------------------- 1. the wizards */
    cc.as(ME.label);
    await openOffCamera('/town', () => hideCard(page));
    cc.say('모두 마법사 로브를 입고 지팡이를 들었어요. 뾰족 모자는 설정에서 벗을 수 있어요.');
    await pause(4500);
    await glideClick(page, page.getByRole('button', { name: '확대' }));
    await pause(1200);
    await glideClick(page, page.getByRole('button', { name: '확대' }));
    await pause(3500);
    await overview();
    await pause(1500);

    /* -------------------------------------------------------------- 2. auras */
    cc.say('이미 공개된 상태는 마법으로 그려져요. 집중 중인 직원04는 방어막, 휴식 중인 직원11은 마나 회복.');
    await pause(1500);
    const menu = await myMenuOn(CAST.qa.name);
    await glideClick(page, menu.getByRole('menuitem', { name: '이 사람 보기' }));
    mark();
    await pause(4000);
    await focusOn(people.dev.id);
    mark();
    await pause(3500);

    /* -------------------------------------------------------------- 3. a fireball for me */
    cc.say('직원11이 나에게 응원 파이어볼! 마법은 모두에게 보이지만, 소리는 쓴 사람과 받은 사람만 들어요.');
    await focusOn(me.id);
    await castFrom(people.dev, me, '응원 파이어볼');
    mark();
    await pause(5500);

    /* -------------------------------------------------------------- 4. a coffee meteor back */
    cc.say('답례로 커피 메테오. 지팡이를 드는 모습은 실제로 마법을 쓴 순간에만 나와요.');
    await castMine(CAST.dev.name, '커피 메테오');
    mark();
    await pause(5500);

    /* -------------------------------------------------------------- 5. combo */
    cc.say('하이파이브를 10초 안에 돌려받으면 콤보! 그 순간의 연출일 뿐, 세거나 남기지 않아요.');
    await focusOn(people.boss.id);
    // 직원03 (next to 직원07) has 직원07's spellbook open in the messenger, so the high-five comes straight back.
    await openPerson(people.boss, me);
    await people.boss.page.getByRole('button', { name: /마법/ }).click();
    const back = people.boss.page
      .getByRole('dialog', { name: `${me.name}님에게 마법 쓰기` })
      .getByRole('button', { name: '하이파이브' });
    await expect(back).toBeEnabled({ timeout: 20_000 });
    await castMine(CAST.boss.name, '하이파이브');
    await expect.poll(() => sfxPlayed(page), { timeout: 10_000 }).toContain('cast.highfive');
    await pause(600);
    await back.click();
    mark();
    await expect.poll(() => sfxPlayed(page), { timeout: 8_000 }).toContain('spell.combo');
    await pause(4500);

    /* -------------------------------------------------------------- 6. a shield */
    cc.say('집중 중인 직원04에게 칭찬 번개를 쓰면 결계에 튕겨요. 직원04에게는 알림도 소리도 가지 않아요.');
    await focusOn(people.qa.id);
    await castMine(CAST.qa.name, '칭찬 번개');
    mark();
    await pause(5000);

    /* -------------------------------------------------------------- 7. raid */
    cc.say('1분 안에 세 명이 한 사람을 응원하면 전설의 응원! 지켜보는 나에게는 소리가 나지 않아요.');
    await focusOn(people.dev.id);
    await castFrom(people.boss, people.dev, '축하 폭죽');
    await pause(1600);
    await castFrom(people.sec, people.dev, '힐링 포션');
    await pause(1600);
    await castFrom(people.pal, people.dev, '응원 파이어볼');
    mark();
    await expect
      .poll(async () => (await fxStrips(page))['spell/raid-pillar'] ?? 0, { timeout: 10_000 })
      .toBeGreaterThan(0);
    await pause(5500);

    /* -------------------------------------------------------------- 8. potion and fireworks */
    cc.say('힐링 포션은 포물선을 그리며 날아가고, 축하 폭죽은 하늘에서 터져요.');
    await focusOn(people.boss.id);
    await castMine(CAST.boss.name, '힐링 포션');
    mark();
    await pause(4000);
    await castFrom(people.boss, me, '축하 폭죽');
    mark();
    await pause(5500);

    /* -------------------------------------------------------------- 9. a call and a log rune */
    cc.say('DM은 종이비행기로 날아와요. 비행기는 주고받는 두 사람의 화면에만, 소리는 받은 나에게만.');
    await overview();
    await openPerson(people.sec, me);
    await people.sec.page.getByRole('link', { name: 'DM 보내기' }).click();
    const dm = people.sec.page.getByRole('textbox', { name: '메시지를 입력하세요' });
    await dm.fill('점심 먹고 잠깐 이야기 나눌 수 있을까요?');
    await dm.press('Enter');
    mark();
    await pause(5000);
    cc.say('동료의 Claude가 업무 로그를 쓰면 머리 위에 룬이 반짝여요. 축하가 아닌 중립적인 표시예요.');
    await focusOn(people.pal.id);
    await palClaude.callTool({
      name: 'post_work_log',
      arguments: {
        summary: '로그인 화면 접근성 점검을 마쳤습니다.',
        tasks: [{ title: '로그인 화면 접근성 점검', status: 'done' }],
      },
    });
    mark();
    await pause(5000);

    /* -------------------------------------------------------------- 10. the familiar */
    cc.say('메신저의 펫 방에서는 사역마와 놀 수 있어요.');
    await openOffCamera('/');
    await expect(page).toHaveURL(/\/pets\//);
    const petName = (await page.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
    await pause(2000);
    cc.say('쓰다듬으면 하트, 간식을 주면 냠냠.');
    await glideClick(page, page.getByRole('button', { name: `${petName} 쓰다듬기` }));
    mark();
    await pause(2500);
    await glideClick(page, page.getByRole('button', { name: '간식 주기' }));
    mark();
    await pause(3000);
    cc.say('"마법 보여 줘"를 누르면 작은 마법을 보여 줘요. 펫은 그림으로만 답하고, 글은 지어내지 않아요.');
    await glideClick(page, page.getByRole('button', { name: '마법 보여 줘' }));
    mark();
    await pause(2600);
    await glideClick(page, page.getByRole('button', { name: '마법 보여 줘' }));
    await pause(2600);

    /* -------------------------------------------------------------- 11. a quest */
    cc.say('할 일은 오늘의 퀘스트예요. 완료하면 퀘스트 완료! 이 연출은 나에게만 보여요.');
    await glideTo(page, page.getByLabel('오늘의 퀘스트'));
    await pause(1500);
    await glideClick(page, page.getByRole('button', { name: `${QUESTS[0]!.title} 완료하기` }));
    mark();
    await pause(4500);

    /* -------------------------------------------------------------- 12. my Claude answers */
    cc.say('펫에게 물어보면, 답은 언제나 내 Claude가 써요. 답이 도착하면 소환진이 그려져요.');
    const composer = page.getByRole('textbox', { name: `${petName}에게 메시지 보내기` });
    await typeInto(page, composer, ASK, 70);
    await composer.press('Enter');
    await pause(2500);
    const inbox = structured<{ pet_inbox?: { items: { message_id: string; owner_text: string }[] } }>(
      await claude.callTool({ name: 'get_my_context', arguments: { include: ['pet_inbox'] } }),
    );
    const asked = inbox.pet_inbox?.items.find((m) => m.owner_text === ASK);
    expect(asked, JSON.stringify(inbox)).toBeTruthy();
    await claude.callTool({
      name: 'post_pet_reply',
      arguments: { replies: [{ in_reply_to: asked!.message_id, text: REPLY }] },
    });
    mark();
    await pause(6000);

    /* -------------------------------------------------------------- 13. a spell reaches the messenger */
    cc.say('메신저만 열어 두어도 마법을 받아요. 오른쪽 타운에도 그대로 그려져요.');
    await castFrom(people.dev, me, '칭찬 번개');
    mark();
    await pause(5500);

    /* -------------------------------------------------------------- 14. a new pet hatches */
    cc.say('새 펫을 만들면 알에서 깨어나요.');
    // The wizard is filled off camera; the last click (만들기) and the hatching are on camera.
    await openOffCamera('/pets/new', async () => undefined);
    v.pause();
    await page.getByRole('textbox', { name: '이름' }).fill('새싹');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '다음' }).click();
    v.resume();
    await glideClick(page, page.getByRole('button', { name: '만들기' }));
    await expect(page).toHaveURL(/hatch=1/);
    mark();
    await pause(5000);

    /* -------------------------------------------------------------- 15. settings */
    cc.say(
      '효과음은 기본으로 작게 켜져 있고, 스피커 버튼이나 설정에서 바로 끌 수 있어요. "마법 받지 않기"도 여기서.',
    );
    await openOffCamera('/me?tab=settings');
    await glideTo(page, page.getByText('효과음', { exact: true }).first());
    await pause(3500);
    await glideTo(page, page.getByText('마법 받지 않기', { exact: true }));
    await pause(3500);

    /* -------------------------------------------------------------- 16. end */
    await showCard(page, 'ENU Den 마법 사무소', [
      '- 이펙트: pixelfx(Patch, MIT)의 방식대로 코드로 그리고, 렌더해서 보고, 고쳤어요.',
      '- 효과음: 녹음 없이 코드로 합성했어요.',
      '~ 다음 이펙트도 .claude/skills/den-fx 로 같은 방법을 따라요.',
    ]);
    cc.clear();
    await pause(6000);
  } finally {
    await video.stop();
    cc.write(path.join(OUT, 'effects-captions.ass'), video.elapsed() + 1);
    await claude.close().catch(() => undefined);
    await palClaude.close().catch(() => undefined);
    for (const c of [...Object.values(people), ...extras]) await c.ctx.close().catch(() => undefined);
    await rec.close().catch(() => undefined);
  }

  // Captions under the app, then the sound track (what 직원07 heard, over the bed), normalised to −16 LUFS.
  const silent = path.join(OUT, 'effects-video.mp4');
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-i',
      path.join(OUT, 'effects-raw.mp4'),
      '-vf',
      `pad=${VIDEO.width}:${VIDEO.height}:0:0:color=0x2d2640,subtitles=${path.join(OUT, 'effects-captions.ass')}`,
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
      silent,
    ],
    { stdio: 'inherit' },
  );
  expect(ff.status).toBe(0);
  const final = muxAudio(silent, taps, video.elapsed(), OUT, path.join(OUT, 'enu-den-effects.mp4'));
  const report = verifyVideo(final, moments);
  console.log(JSON.stringify({ taps: taps.map((t) => `${t.t.toFixed(1)}s ${t.id}`), report }, null, 2));
  expect(report.audio).toContain('aac');
  expect(Math.abs(report.lufs + 16)).toBeLessThan(1.5);
  expect(report.truePeak).toBeLessThan(-0.9);
  expect(taps.some((t) => t.id.startsWith('hit.'))).toBe(true);
});
