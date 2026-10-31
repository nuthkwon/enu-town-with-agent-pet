import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type BrowserContext, type Locator } from '@playwright/test';
import { ROOT, devEmail } from '../env';
import { devLogin, userIdOf } from '../support/auth';
import { connectClaude, mcpClient, structured } from '../support/claude';
import { fxStrips, sfxPlayed, waitForTownState, wakeSound } from '../support/town';
import { listenForSounds, type Tap } from './audio';
import {
  arrive,
  colleague,
  followServerClock,
  openPerson,
  readyCast,
  serverNow,
  shifted,
  statusOf,
  type Colleague,
} from './colleagues';
import { installOverlay, typeInto } from './overlay';
import { startRecording, type Recording } from './recorder';
import type { Moment, Point } from './trailer/moments';

/**
 * Footage for the gameplay trailer (demo/trailer): 직원07's town with the chrome hidden, recorded at 960×720 and zoom 1
 * (the whole office with the pixel art at its own size, cheap enough to draw at full frame rate; the editor crops
 * 16:9 frames from it and scales them up by whole numbers),
 * while pseudonymous colleagues arrive, leave, cast and meet, each from their own screen; then 직원07's pet room at
 * twice the pixel density. Every moment is logged with its video time, the frame its effect landed on (read from the
 * scene's own effect counters) and where its subject was on screen, so the editor can cut on the beat and crop close
 * (demo/trailer/build.ts). Sounds are the ones 직원07's screens played.
 *
 * Run against a demo stack: `pnpm --filter @enu/e2e demo:trailer`, then `demo:trailer:edit`. Output: demo-output/trailer.
 */

const OUT = path.join(process.env.DEMO_OUT ?? path.join(ROOT, 'demo-output'), 'trailer');
const ME = { desk: 'R2b', name: '직원07' };
/** Quests and the reply carry no digits (nothing on screen in the trailer reads like a count or a score). */
const QUESTS = [
  { external_ref: 'demo:quest:review', title: 'PR 리뷰 마무리', priority: 1 },
  { external_ref: 'demo:quest:release', title: '릴리스 노트 초안 쓰기', priority: 2 },
];
const ASK = '오늘 남은 퀘스트 알려 줘';
/** 직원07's Claude, answering through the connector (verbatim; ENU Den never writes this). */
const REPLY = '남은 퀘스트는 하나예요: 릴리스 노트 초안 쓰기. 점심 전에 끝내면 리뷰 일정과 겹치지 않아요.';

/** Only the game: the town's bars, chat dock, toasts, hover cards and the demo pointer are hidden. */
const TRAILER_CSS = `
  [class*="town-module__"][class*="__topBar"] { opacity: 0 !important; }
  [class*="town-module__"][class*="__dock"], [class*="town-module__"][class*="__banners"],
  [class*="town-module__"][class*="__toasts"], [class*="town-module__"][class*="__hoverCard"],
  [class*="town-module__"][class*="__legend"], [class*="town-module__"][class*="__nightBanner"] { display: none !important; }
`;
const POINTER_OFF = '#demo-pointer, .demo-ripple { display: none !important; }';
/**
 * The town is filmed at its pixel art's own size, tall enough for the whole office and an avatar menu with its
 * spellbook; the pet room at twice the density (crisp text and sprites).
 */
const TOWN = { width: 960, height: 720 };
/**
 * The town's clock runs at half speed while it is filmed (its animation frames and timers read a slowed
 * `performance.now` and frame clock): a software-drawn canvas manages about 15 frames a second here, so at half
 * speed every effect gets twice the frames, and the editor plays the footage back at double speed (SOURCES.town.pace).
 * Everything that is not drawn by the game (the server, its rate limits, sounds) keeps real time.
 */
const WARP = 0.5;

/** Slows a page's game clock (`performance.now` and requestAnimationFrame timestamps) to `warp` of real time. */
function slowClock(warp: number): void {
  const real = performance.now.bind(performance);
  const t0 = real();
  performance.now = () => t0 + (real() - t0) * warp;
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((ts) => cb(t0 + (ts - t0) * warp));
}
const PET = { width: 960, height: 540, scale: 2 };

/** Hides the chrome (and the demo pointer until a shot shows it) in every page of a recording context. */
async function trailerChrome(ctx: BrowserContext): Promise<void> {
  await installOverlay(ctx);
  await ctx.addInitScript(
    ([css, pointerOff]) => {
      try {
        localStorage.setItem('enu-den:rail-hidden', '1');
      } catch {
        // storage unavailable: the rail stays (it is hidden below)
      }
      const add = () => {
        const s = document.createElement('style');
        s.textContent = css!;
        document.head.appendChild(s);
        const p = document.createElement('style');
        p.id = 'trailer-pointer-off';
        p.textContent = pointerOff!;
        document.head.appendChild(p);
      };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add);
      else add();
    },
    [TRAILER_CSS, POINTER_OFF],
  );
}

/** A calendar block from now on (Asia/Seoul office day), as a colleague's own Claude reports it. */
function block(kind: 'away' | 'focus' | 'meeting', minutes: number, ref?: string) {
  const FIVE_MIN = 5 * 60_000;
  const start = new Date(Math.floor(serverNow() / FIVE_MIN) * FIVE_MIN);
  return {
    start_at: start.toISOString(),
    end_at: new Date(start.getTime() + minutes * 60_000).toISOString(),
    kind,
    ...(ref ? { ref } : {}),
  };
}

test('ENU Den trailer footage: the town', async ({ browser }) => {
  test.setTimeout(40 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await followServerClock();

  /* ---------------------------------------------------------------- pre-roll (not recorded) */
  const who = {
    boss: await colleague(browser, 'R1', '직원03'),
    r2a: await colleague(browser, 'R2a', '직원06'),
    l3b: await colleague(browser, 'L3b', '직원09'),
    qa: await colleague(browser, 'L2a', '직원04'),
    brk: await colleague(browser, 'L4a', '직원11'),
    dm: await colleague(browser, 'L2b', '직원05'),
    away: await colleague(browser, 'L1b', '직원02'),
    m1: await colleague(browser, 'L3a', '직원08'),
    m2: await colleague(browser, 'L4b', '직원12'),
    m3: await colleague(browser, 'L5b', '직원14'),
    x1: await colleague(browser, 'L1a', '직원01'),
    x2: await colleague(browser, 'L5a', '직원13'),
    // Arrives on camera.
    r3b: await colleague(browser, 'R3b', '직원10', { open: false }),
  };
  const claudeOf = async (c: Colleague) => mcpClient((await connectClaude(c.ctx)).token);
  const claude = {
    qa: await claudeOf(who.qa),
    away: await claudeOf(who.away),
    r2a: await claudeOf(who.r2a),
    m1: await claudeOf(who.m1),
    m2: await claudeOf(who.m2),
    m3: await claudeOf(who.m3),
  };
  // Already public before the video: 직원04's calendar focus time (a shield) and 직원11's break (mana motes).
  await claude.qa.callTool({
    name: 'post_activity',
    arguments: { now: null, schedule: [block('focus', 60)] },
  });
  await statusOf(who.brk, '휴식', '1시간');

  const rec = await browser.newContext({ viewport: TOWN, bypassCSP: true });
  await trailerChrome(rec);
  await rec.addInitScript(slowClock, WARP);
  let video: Recording | null = null;
  const townTaps: Tap[] = await listenForSounds(rec, () => video);
  await devLogin(rec, devEmail(ME.desk));
  const me = { id: await userIdOf(rec), name: ME.name };
  const page = await rec.newPage();
  page.setDefaultTimeout(30_000);
  await shifted(page);
  for (const url of ['/', '/pets/new', '/all', '/town']) {
    await page.goto(url);
    await page.waitForLoadState('networkidle').catch(() => undefined);
  }
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
  await waitForTownState(page);
  await wakeSound(page);
  // The casters already have 직원07's page open in their messenger.
  for (const c of [who.boss, who.r2a, who.dm]) await openPerson(c, me);

  const where = async (id: string): Promise<Point> => {
    const p = await page.evaluate((u) => window.__ENU_DEN_DEBUG__?.avatarScreen(u) ?? null, id);
    if (!p) throw new Error(`not drawn: ${id}`);
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };
  const strips = async (id: string) => (await fxStrips(page))[id] ?? 0;
  const pointer = (on: boolean) =>
    page.evaluate(
      ([show, css]) => {
        const el = document.getElementById('trailer-pointer-off');
        if (show) el?.remove();
        else if (!el) {
          const p = document.createElement('style');
          p.id = 'trailer-pointer-off';
          p.textContent = css!;
          document.head.appendChild(p);
        }
      },
      [on, POINTER_OFF] as const,
    );
  const corner = () => page.mouse.move(TOWN.width - 6, TOWN.height - 4, { steps: 3 });

  // The whole office at zoom 1 (전체 보기; one step in if the fit is compact); the camera stays here.
  const zoomNow = () => page.evaluate(() => window.__ENU_DEN_DEBUG__?.zoom() ?? 0);
  const overviewButton = page.getByRole('button', { name: '전체 보기' });
  if (await overviewButton.isEnabled()) await overviewButton.click();
  for (let i = 0; i < 4 && (await zoomNow()) < 1; i++) {
    await page.getByRole('button', { name: '확대' }).click();
    await page.waitForTimeout(400);
  }
  await expect.poll(zoomNow).toBe(1);
  await corner();
  await page.waitForTimeout(1500);

  video = await startRecording(page, path.join(OUT, 'capture-town.mp4'), 30, {
    quality: 98,
    crf: 8,
    pixFmt: 'yuv444p',
    preset: 'ultrafast',
  });
  const v = video;
  const moments: Moment[] = [];
  /** Waits `ms` of the town's (slowed) time. */
  const pause = (ms: number) => page.waitForTimeout(ms / WARP);
  /** When the effect `strip` starts on this screen after `before` of them (the frame it lands on). */
  const landed = async (strip: string, before: number, timeoutMs = 8000): Promise<number | null> => {
    const end = Date.now() + timeoutMs / WARP;
    while (Date.now() < end) {
      if ((await strips(strip)) > before) return Math.max(0, v.elapsed() - 0.03);
      await page.waitForTimeout(25);
    }
    return null;
  };
  const log = (m: Omit<Moment, 'source'> & { source?: Moment['source'] }) => {
    moments.push({ source: 'town', ...m });
    console.log(
      `moment ${m.name} t=${m.t.toFixed(2)} impact=${m.impact?.toFixed(2) ?? '-'} at=${m.at.x},${m.at.y}`,
    );
  };
  /** 직원07 casts from the avatar menu on the canvas (the pointer stays hidden unless `show`). */
  const castMine = async (target: Colleague, spell: string, hitStrip: string, name: string, show = false) => {
    const at = await where(target.id);
    const from = await where(me.id);
    await page.mouse.move(at.x, at.y, { steps: show ? 12 : 6 });
    if (show) await pause(350);
    const ui = v.elapsed();
    await page.mouse.click(at.x, at.y);
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    const button = menu.getByRole('menuitem', { name: spell });
    await expect(button).toBeEnabled({ timeout: 20_000 });
    let book: Moment | null = null;
    if (show) {
      // The shot looks at the spellbook itself (the grid of spells at the bottom of the menu).
      const grid = await menu
        .locator('[data-spell]')
        .first()
        .evaluate((el) => {
          const r = (el.parentElement ?? el).getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        });
      book = {
        source: 'town',
        name: 'spellbook',
        t: v.elapsed() - 0.6,
        at: { x: Math.round(grid.x), y: Math.round(grid.y) },
        end: 0,
        ui,
      };
      // Over the spell icons one by one (few pointer steps: the recorded page is busy drawing the town).
      for (const icon of await menu.locator('[data-spell]').all()) {
        const b = await icon.boundingBox();
        if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
        await pause(220);
      }
      const b = await button.boundingBox();
      if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
      await pause(300);
    }
    const before = await strips(hitStrip);
    const charges = await strips('spell/charge');
    const t = v.elapsed();
    await button.click();
    if (book) log({ ...book, end: v.elapsed() + 0.3 });
    await corner();
    // The wand goes up when the server's answer arrives (the charge at its tip), then the spell lands.
    const raised = await landed('spell/charge', charges);
    const impact = await landed(hitStrip, before);
    log({
      name,
      t: raised ?? t,
      impact: impact ?? undefined,
      end: (impact ?? t + 1) + 1.6,
      at,
      from,
      ...(show ? {} : { ui }),
    });
    // Every cast of 직원07's is also a take of the wand going up.
    if (raised !== null)
      log({ name: 'cast', t: raised - 0.1, impact: raised + 0.15, end: raised + 1.2, at: from });
    // Let the effect play out before anything else happens on screen.
    await pause(1500);
    return { t: raised ?? t, impact };
  };
  /** A spell between two colleagues (both cast from their own screens; 직원07 only watches). */
  const castBetween = async (
    from: Colleague,
    to: Colleague,
    spell: string,
    hitStrip: string,
    name: string,
  ) => {
    const button = await readyCast(from, to, spell);
    const at = await where(to.id);
    const src = await where(from.id);
    const before = await strips(hitStrip);
    const t = v.elapsed();
    await button.click();
    const impact = await landed(hitStrip, before);
    log({ name, t, impact: impact ?? undefined, end: (impact ?? t + 1) + 1.6, at, from: src });
    return impact;
  };
  /** A quiet stretch of the office, as it is. */
  const establish = async (ms: number) => {
    const t = v.elapsed();
    log({ name: 'establish', t, at: { x: TOWN.width / 2, y: TOWN.height / 2 }, end: t + ms / 1000 / WARP });
    await pause(ms);
  };
  try {
    /* ---------------------------------------------------------- the office */
    await pause(1200);
    await establish(4800);

    // 직원10 opens the messenger: a warp beam at their desk.
    {
      const before = await strips('town/warp-in');
      const t = v.elapsed();
      await arrive(who.r3b);
      const impact = await landed('town/warp-in', before, 20_000);
      log({
        name: 'arrive',
        t: (impact ?? t) - 0.2,
        impact: impact ?? undefined,
        end: (impact ?? t) + 1.6,
        at: await where(who.r3b.id),
      });
      await pause(2000);
    }

    // 직원02's Claude reports an away block (외근): they blink out.
    {
      const at = await where(who.away.id);
      const before = await strips('town/blink-out');
      const t = v.elapsed();
      await claude.away.callTool({
        name: 'post_activity',
        arguments: { now: null, schedule: [block('away', 60)] },
      });
      const impact = await landed('town/blink-out', before, 15_000);
      log({
        name: 'leave',
        t: (impact ?? t) - 0.2,
        impact: impact ?? undefined,
        end: (impact ?? t) + 1.3,
        at,
      });
      await pause(1800);
    }

    /* ---------------------------------------------------------- 직원07 casts */
    const t0 = Date.now();
    const at = (s: number) => pause(Math.max(0, t0 + s * 1000 - Date.now()));
    await castMine(who.l3b, '응원 파이어볼', 'spell/fireball-hit', 'fireball');
    await at(7);
    await castMine(who.r2a, '칭찬 번개', 'spell/zap-strike', 'zap');
    await at(14);
    await castMine(who.qa, '칭찬 번개', 'spell/shield-block', 'shield');
    await at(21);
    await pointer(true);
    await castMine(who.boss, '축하 폭죽', 'spell/fireworks', 'fireworks', true);
    await pointer(false);
    await at(29);
    await castMine(who.r3b, '힐링 포션', 'spell/heal', 'potion');
    await pause(2500);

    /* ---------------------------------------------------------- a high-five, returned at once: combo */
    await at(38);
    {
      const back = await readyCast(who.boss, me, '하이파이브');
      const aim = await where(who.boss.id);
      await page.mouse.move(aim.x, aim.y, { steps: 6 });
      await page.mouse.click(aim.x, aim.y);
      const menu = page.getByRole('menu');
      const five = menu.getByRole('menuitem', { name: '하이파이브' });
      await expect(five).toBeEnabled({ timeout: 20_000 });
      const before = await strips('spell/combo-burst');
      const t = v.elapsed();
      await five.click();
      await corner();
      await expect.poll(() => sfxPlayed(page), { timeout: 10_000 }).toContain('cast.highfive');
      await pause(350);
      await back.click();
      const impact = await landed('spell/combo-burst', before);
      log({
        name: 'combo',
        t,
        impact: impact ?? undefined,
        end: (impact ?? t + 1) + 1.4,
        at: aim,
        from: await where(me.id),
      });
      await pause(2500);
    }

    /* ---------------------------------------------------------- a paper plane and a rune (the combo's limits cool down) */
    {
      await openPerson(who.dm, me);
      await who.dm.page.getByRole('link', { name: 'DM 보내기' }).click();
      const box = who.dm.page.getByRole('textbox', { name: '메시지를 입력하세요' });
      await box.fill('점심 먹고 잠깐 이야기 나눌 수 있을까요?');
      const before = await strips('town/plane-puff');
      const t = v.elapsed();
      await box.press('Enter');
      const impact = await landed('town/plane-puff', before, 10_000);
      log({
        name: 'dm',
        t,
        impact: impact ?? undefined,
        end: (impact ?? t + 1) + 1,
        at: await where(me.id),
        from: await where(who.dm.id),
      });
      await pause(2500);
    }
    {
      const before = await strips('town/rune-spark');
      const t = v.elapsed();
      await claude.r2a.callTool({
        name: 'post_work_log',
        arguments: {
          summary: '결제 모듈 리팩터링 1차를 마쳤습니다.',
          tasks: [{ title: '결제 모듈 리팩터링', status: 'done' }],
        },
      });
      const impact = await landed('town/rune-spark', before, 10_000);
      log({
        name: 'rune',
        t,
        impact: impact ?? undefined,
        end: (impact ?? t + 1) + 1.2,
        at: await where(who.r2a.id),
      });
      await pause(2000);
    }

    /* ---------------------------------------------------------- three colleagues cheer 직원07 at once: coffee, potion, fireball → raid */
    {
      const coffee = await readyCast(who.r2a, me, '커피 메테오');
      const potion = await readyCast(who.r3b, me, '힐링 포션');
      const fire = await readyCast(who.boss, me, '응원 파이어볼');
      await at(60);
      const target = await where(me.id);
      const casters = {
        coffee: await where(who.r2a.id),
        potion: await where(who.r3b.id),
        fireball: await where(who.boss.id),
      };
      const hits = {
        coffee: 'spell/coffee-splash',
        potion: 'spell/heal',
        fireball: 'spell/fireball-hit',
        raid: 'spell/raid-pillar',
      } as const;
      const before = Object.fromEntries(
        await Promise.all(Object.entries(hits).map(async ([k, id]) => [k, await strips(id)] as const)),
      );
      const raidT = v.elapsed();
      const sent: Record<string, number> = {};
      for (const [name, button] of [
        ['coffee', coffee],
        ['potion', potion],
        ['fireball', fire],
      ] as const) {
        sent[name] = v.elapsed();
        await button.click();
        await page.waitForTimeout(250);
      }
      // Each effect's first frame, watched together (they land within a second or two of each other).
      const seen: Record<string, number> = {};
      const end = Date.now() + 12_000 / WARP;
      while (Date.now() < end && Object.keys(seen).length < 4) {
        const now = await fxStrips(page);
        for (const [k, id] of Object.entries(hits))
          if (seen[k] === undefined && (now[id] ?? 0) > before[k]!) seen[k] = Math.max(0, v.elapsed() - 0.03);
        await page.waitForTimeout(25);
      }
      for (const name of ['coffee', 'potion', 'fireball'] as const)
        log({
          name,
          t: sent[name]!,
          impact: seen[name],
          end: (seen[name] ?? sent[name]! + 1) + 1.6,
          at: target,
          from: casters[name],
        });
      log({ name: 'raid', t: raidT, impact: seen.raid, end: (seen.raid ?? raidT + 4) + 2.4, at: target });
      await pause(3500);
    }

    /* ---------------------------------------------------------- round two: more takes, across the aisle */
    await establish(3500);
    {
      // 직원05 and 직원09 trade high-fives (both spellbooks open): a second combo.
      const there = await readyCast(who.dm, who.l3b, '하이파이브');
      const back = await readyCast(who.l3b, who.dm, '하이파이브');
      const at = await where(who.l3b.id);
      const src = await where(who.dm.id);
      const before = await strips('spell/combo-burst');
      const t = v.elapsed();
      await there.click();
      await pause(900);
      await back.click();
      const impact = await landed('spell/combo-burst', before);
      log({ name: 'combo', t, impact: impact ?? undefined, end: (impact ?? t + 1) + 1.4, at, from: src });
      await pause(1500);
    }
    await castBetween(who.dm, who.qa, '응원 파이어볼', 'spell/shield-block', 'shield');
    await pause(1200);
    await castBetween(who.x2, who.l3b, '커피 메테오', 'spell/coffee-splash', 'coffee');
    await pause(1200);
    await castBetween(who.x1, who.x2, '축하 폭죽', 'spell/fireworks', 'fireworks');
    await pause(1500);
    const t2 = Date.now();
    await castMine(who.x2, '칭찬 번개', 'spell/zap-strike', 'zap');
    await pause(1500);
    // (Not at 직원09: a third cheer on them within the minute would be a raid.)
    await castMine(who.x1, '축하 폭죽', 'spell/fireworks', 'fireworks');
    await pause(1500);
    await castMine(who.dm, '커피 메테오', 'spell/coffee-splash', 'coffee');
    await pause(Math.max(0, t2 + 16_000 - Date.now()));
    await castBetween(who.l3b, who.dm, '칭찬 번개', 'spell/zap-strike', 'zap');
    await pause(1500);
    await castBetween(who.x2, who.x1, '힐링 포션', 'spell/heal', 'potion');
    await pause(1500);

    // 직원02 is back (their Claude clears the away block); 직원06 heads out; 직원04's Claude writes a log.
    {
      const before = await strips('town/warp-in');
      const t = v.elapsed();
      await claude.away.callTool({ name: 'post_activity', arguments: { now: null, schedule: [] } });
      const impact = await landed('town/warp-in', before, 15_000);
      log({
        name: 'arrive',
        t: (impact ?? t) - 0.2,
        impact: impact ?? undefined,
        end: (impact ?? t) + 1.6,
        at: await where(who.away.id),
      });
      await pause(1800);
    }
    {
      const at = await where(who.r2a.id);
      const before = await strips('town/blink-out');
      const t = v.elapsed();
      await claude.r2a.callTool({
        name: 'post_activity',
        arguments: { now: null, schedule: [block('away', 60)] },
      });
      const impact = await landed('town/blink-out', before, 15_000);
      log({
        name: 'leave',
        t: (impact ?? t) - 0.2,
        impact: impact ?? undefined,
        end: (impact ?? t) + 1.3,
        at,
      });
      await pause(1800);
    }
    {
      const before = await strips('town/rune-spark');
      const t = v.elapsed();
      await claude.qa.callTool({
        name: 'post_work_log',
        arguments: {
          summary: '회귀 테스트 시나리오를 정리했습니다.',
          tasks: [{ title: '회귀 테스트 시나리오 정리', status: 'done' }],
        },
      });
      const impact = await landed('town/rune-spark', before, 10_000);
      log({
        name: 'rune',
        t,
        impact: impact ?? undefined,
        end: (impact ?? t + 1) + 1.2,
        at: await where(who.qa.id),
      });
      await pause(1500);
    }

    // 직원01 calls 직원07 (부르기, from their own town): a bouncy "!" over 직원07.
    {
      v.pause();
      await who.x1.page.goto('/town');
      await expect(who.x1.page.locator('canvas').first()).toBeVisible({ timeout: 90_000 });
      await waitForTownState(who.x1.page);
      const mine = await who.x1.page.evaluate(
        (u) => window.__ENU_DEN_DEBUG__?.avatarScreen(u) ?? null,
        me.id,
      );
      const box = await who.x1.page.locator('canvas').first().boundingBox();
      await who.x1.page.mouse.click(box!.x + mine!.x, box!.y + mine!.y);
      const call = who.x1.page.getByRole('menu').getByRole('menuitem', { name: '부르기' });
      await expect(call).toBeEnabled();
      await page.waitForTimeout(1500);
      v.resume();
      await pause(600);
      const before = await strips('town/ping-bang');
      const t = v.elapsed();
      await call.click();
      const impact = await landed('town/ping-bang', before, 10_000);
      log({
        name: 'ping',
        t,
        impact: impact ?? undefined,
        end: (impact ?? t + 1) + 1.2,
        at: await where(me.id),
      });
      await pause(2000);
      v.pause();
      await arrive(who.x1);
      await page.waitForTimeout(800);
      v.resume();
    }
    await establish(3000);

    /* ---------------------------------------------------------- a meeting gathers: the party circle */
    {
      const before = await strips('aura/party-cast');
      const t = v.elapsed();
      const meeting = block('meeting', 30, 'gcal:trailer-weekly-sync@enu-tech.co.kr');
      for (const c of [claude.m1, claude.m2, claude.m3])
        await c.callTool({ name: 'post_activity', arguments: { now: null, schedule: [meeting] } });
      const impact = await landed('aura/party-cast', before, 40_000);
      const ids = [who.m1.id, who.m2.id, who.m3.id];
      const ps = await Promise.all(ids.map(where));
      const centre = {
        x: Math.round(ps.reduce((s, p) => s + p.x, 0) / 3),
        y: Math.round(ps.reduce((s, p) => s + p.y, 0) / 3),
      };
      log({
        name: 'party',
        t: (impact ?? t) - 1.2,
        impact: impact ?? undefined,
        end: (impact ?? t) + 3.5,
        at: centre,
      });
      await pause(4000);
    }
  } finally {
    await video.stop();
    // Whatever was filmed is kept (a failed step later on still leaves the moments before it).
    writeFileSync(path.join(OUT, 'moments-town.json'), JSON.stringify(moments, null, 1));
    writeFileSync(
      path.join(OUT, 'taps-town.json'),
      JSON.stringify(townTaps.map((x) => ({ ...x, source: 'town' }))),
    );
    for (const c of Object.values(claude)) await c.close().catch(() => undefined);
    for (const c of Object.values(who)) await c.ctx.close().catch(() => undefined);
    await rec.close().catch(() => undefined);
  }
  console.log(`${moments.length} moments, ${townTaps.length} sounds: ${OUT}`);
  for (const name of [
    'fireball',
    'zap',
    'shield',
    'fireworks',
    'potion',
    'combo',
    'raid',
    'party',
    'arrive',
    'leave',
    'ping',
  ])
    expect(moments.find((m) => m.name === name)?.impact, name).toBeDefined();
});

/** 직원07's pet room, filmed on its own (it can be filmed again without the town). */
test('ENU Den trailer footage: the pet room', async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  mkdirSync(OUT, { recursive: true });
  await followServerClock();
  const moments: Moment[] = [];
  const petCtx = await browser.newContext({
    viewport: { width: PET.width, height: PET.height },
    deviceScaleFactor: PET.scale,
    bypassCSP: true,
  });
  await trailerChrome(petCtx);
  let petVideo: Recording | null = null;
  const petTaps: Tap[] = await listenForSounds(petCtx, () => petVideo);
  await devLogin(petCtx, devEmail(ME.desk));
  const myClaude = await mcpClient((await connectClaude(petCtx)).token);
  await myClaude.callTool({ name: 'upsert_todos', arguments: { items: QUESTS } });
  const room = await petCtx.newPage();
  room.setDefaultTimeout(30_000);
  await shifted(room);
  await room.goto('/');
  await expect(room).toHaveURL(/\/pets\//);
  await room.waitForLoadState('networkidle').catch(() => undefined);
  await wakeSound(room);
  const petName = (await room.getByRole('heading', { level: 1 }).textContent())?.trim() ?? '';
  const familiar = room.getByRole('button', { name: `${petName} 쓰다듬기` });
  /** Centre of an element in the recording's device pixels. */
  const centreOf = async (l: Locator): Promise<Point> => {
    const b = await l.boundingBox();
    return {
      x: Math.round((b!.x + b!.width / 2) * PET.scale),
      y: Math.round((b!.y + b!.height / 2) * PET.scale),
    };
  };
  const away = () => room.mouse.move(PET.width - 6, PET.height - 4, { steps: 3 });
  await away();
  await room.waitForTimeout(1500);
  petVideo = await startRecording(room, path.join(OUT, 'capture-pet.mp4'), 30, {
    quality: 98,
    crf: 8,
    pixFmt: 'yuv444p',
    preset: 'ultrafast',
    size: { width: PET.width * PET.scale, height: PET.height * PET.scale },
  });
  const pv = petVideo;
  const rest = (ms: number) => room.waitForTimeout(ms);
  const petLog = (m: Omit<Moment, 'source'>) => {
    moments.push({ source: 'pet', ...m });
    console.log(`moment ${m.name} t=${m.t.toFixed(2)} at=${m.at.x},${m.at.y} (pet room)`);
  };
  try {
    const pet = await centreOf(familiar);
    const tap = async (l: Locator, name: string, hold: number, at: Point = pet) => {
      const t = pv.elapsed();
      await l.click();
      await away();
      petLog({ name, t, impact: t + 0.05, end: t + hold, at });
      await rest(hold * 1000 + 400);
    };
    await rest(1200);
    await tap(familiar, 'pat', 1.2);
    await tap(room.getByRole('button', { name: '간식 주기' }), 'snack', 1.6);
    for (let round = 0; round < 2; round++) {
      for (const name of ['petshow_fire', 'petshow_ice', 'petshow_star', 'petshow_zap'])
        await tap(room.getByRole('button', { name: '마법 보여 줘' }), name, 1.3);
      await tap(
        round ? room.getByRole('button', { name: '간식 주기' }) : familiar,
        round ? 'snack' : 'pat',
        1.4,
      );
    }
    await tap(
      room.getByRole('button', { name: `${QUESTS[0]!.title} 완료하기` }),
      'quest',
      1.8,
      await centreOf(room.getByLabel('오늘의 퀘스트')),
    );
    {
      // Ask the familiar; the answer is what 직원07's own Claude writes (through the connector).
      const composer = room.getByRole('textbox', { name: `${petName}에게 메시지 보내기` });
      await typeInto(room, composer, ASK, 35);
      await composer.press('Enter');
      await expect(composer).toHaveValue('', { timeout: 15_000 });
      await away();
      let asked: { message_id: string; owner_text: string } | undefined;
      await expect
        .poll(
          async () => {
            const inbox = structured<{ pet_inbox?: { items: { message_id: string; owner_text: string }[] } }>(
              await myClaude.callTool({ name: 'get_my_context', arguments: { include: ['pet_inbox'] } }),
            );
            asked = inbox.pet_inbox?.items.find((m) => m.owner_text === ASK);
            return !!asked;
          },
          { timeout: 20_000 },
        )
        .toBe(true);
      await rest(800);
      const t = pv.elapsed();
      await myClaude.callTool({
        name: 'post_pet_reply',
        arguments: { replies: [{ in_reply_to: asked!.message_id, text: REPLY }] },
      });
      await expect.poll(() => sfxPlayed(room), { timeout: 15_000 }).toContain('pet.reply');
      const impact = pv.elapsed() - 0.05;
      petLog({ name: 'reply', t, impact, end: impact + 2, at: pet });
      await rest(3000);
    }

    // A new pet hatches (the wizard is filled off camera; the last click is on camera).
    pv.pause();
    await room.goto('/pets/new');
    await room.getByRole('textbox', { name: '이름' }).fill('새싹');
    for (let i = 0; i < 4; i++) await room.getByRole('button', { name: '다음' }).click();
    await away();
    await room.waitForTimeout(1200);
    pv.resume();
    await room.getByRole('button', { name: '만들기' }).click();
    await expect(room).toHaveURL(/hatch=1/);
    const hatchPet = await centreOf(room.getByRole('button', { name: /쓰다듬기$/ }));
    const t = pv.elapsed();
    petLog({ name: 'hatch', t, impact: t + 1.2, end: t + 2.6, at: hatchPet });
    await rest(3500);
  } finally {
    await pv.stop();
    writeFileSync(path.join(OUT, 'moments-pet.json'), JSON.stringify(moments, null, 1));
    writeFileSync(
      path.join(OUT, 'taps-pet.json'),
      JSON.stringify(petTaps.map((x) => ({ ...x, source: 'pet' }))),
    );
    await myClaude.close().catch(() => undefined);
    await petCtx.close().catch(() => undefined);
  }
  console.log(`${moments.length} moments, ${petTaps.length} sounds: ${OUT}`);
  for (const name of ['pat', 'snack', 'quest', 'reply', 'hatch'])
    expect(
      moments.some((m) => m.name === name),
      name,
    ).toBe(true);
});
