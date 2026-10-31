import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { devEmail } from '../env';
import { devLogin, openTown, userIdOf } from '../support/auth';
import {
  fxDrawn,
  fxStrips,
  openMenuFromRail,
  playerState,
  setMyStatus,
  sfxPlayed,
  waitForTownState,
  wakeSound,
} from '../support/town';

/**
 * Spells (ADR 0008): public like a wave, but only the two people involved hear them; a focused target's shield
 * bounces them silently; a returned high-five is a combo; three casters within a minute make a raid;
 * 마법 받지 않기 turns them off; they reach someone who keeps only the messenger open.
 * Example roster (pseudonyms): L3b = 직원09, R1 = 직원03, L5a = 직원13, L2b = 직원05, L1b = 직원02 (직원14 must stay
 * someone who never opened the town, for the visualization spec).
 */

interface Person {
  context: BrowserContext;
  page: Page;
  userId: string;
  name: string;
}

test.describe.configure({ mode: 'serial' });

let a: Person;
let b: Person;
let c: Person;
let d: Person;
let e: Person;

async function person(browser: Browser, deskId: string, name: string): Promise<Person> {
  const context = await browser.newContext();
  await devLogin(context, devEmail(deskId));
  const userId = await userIdOf(context);
  const page = await context.newPage();
  await openTown(page);
  await waitForTownState(page);
  await wakeSound(page);
  return { context, page, userId, name };
}

async function cast(from: Person, to: Person, spell: string): Promise<void> {
  const menu = await openMenuFromRail(from.page, to.name);
  const button = menu.getByRole('menuitem', { name: spell });
  await expect(button).toBeEnabled();
  await button.click();
  await expect(from.page.getByRole('menu')).toHaveCount(0);
}

const spellSounds = (ids: string[]) => ids.filter((id) => /^(cast|hit|spell)\./.test(id));

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  a = await person(browser, 'L3b', '직원09');
  b = await person(browser, 'R1', '직원03');
  c = await person(browser, 'L5a', '직원13');
  d = await person(browser, 'L2b', '직원05');
  e = await person(browser, 'L1b', '직원02');
  for (const p of [a, b, c, d, e]) {
    // Nobody starts behind a shield from an earlier spec.
    await setMyStatus(p.page, '자동 (일정·Claude·업무 기록 기준)');
    await expect
      .poll(async () => (await playerState(a.page, p.userId))?.shown, { timeout: 20_000 })
      .toBe(true);
  }
});

test.afterAll(async () => {
  for (const p of [a, b, c, d, e]) await p?.context.close();
});

test('a spell plays on every screen, but only the caster and the target hear it', async () => {
  const before = (await fxDrawn(c.page)).spell;
  await cast(a, b, '응원 파이어볼');
  // Everyone sees it (the third party's screen draws the show) ...
  await expect.poll(async () => (await fxDrawn(c.page)).spell).toBeGreaterThan(before);
  await expect.poll(async () => (await fxStrips(c.page))['spell/fireball-hit'] ?? 0).toBeGreaterThan(0);
  // ... the target gets a toast (it stays a few seconds), the caster hears the cast, the target the hit ...
  await expect(b.page.getByText('직원09님의 응원 파이어볼!')).toBeVisible();
  await expect.poll(async () => spellSounds(await sfxPlayed(a.page))).toContain('cast.fireball');
  await expect.poll(async () => spellSounds(await sfxPlayed(b.page))).toContain('hit.fireball');
  // ... and the third party hears nothing and gets no toast.
  await c.page.waitForTimeout(800);
  expect(spellSounds(await sfxPlayed(c.page))).toEqual([]);
  await expect(c.page.getByText('응원 파이어볼!')).toHaveCount(0);
});

test('a returned high-five within ten seconds is a combo for both', async () => {
  await cast(d, c, '하이파이브');
  await expect.poll(async () => spellSounds(await sfxPlayed(c.page))).toContain('hit.highfive');
  await cast(c, d, '하이파이브');
  await expect.poll(async () => spellSounds(await sfxPlayed(c.page))).toContain('spell.combo');
  await expect.poll(async () => spellSounds(await sfxPlayed(d.page))).toContain('spell.combo');
  await expect.poll(async () => (await fxStrips(a.page))['spell/combo-burst'] ?? 0).toBeGreaterThan(0);
});

test('a focused target is shielded: the spell bounces and the target hears nothing', async () => {
  await setMyStatus(b.page, '집중 모드');
  await expect.poll(async () => (await fxStrips(e.page))['aura/focus-shield'] ?? 0).toBeGreaterThan(0);
  const heardBefore = spellSounds(await sfxPlayed(b.page)).length;
  await cast(e, b, '칭찬 번개');
  await expect.poll(async () => spellSounds(await sfxPlayed(e.page))).toContain('spell.blocked');
  await expect.poll(async () => (await fxStrips(a.page))['spell/shield-block'] ?? 0).toBeGreaterThan(0);
  await b.page.waitForTimeout(800);
  expect(spellSounds(await sfxPlayed(b.page)).length).toBe(heardBefore);
  await setMyStatus(b.page, '자동 (일정·Claude·업무 기록 기준)');
});

test('three colleagues within a minute raise a legendary cheer', async () => {
  await cast(a, e, '힐링 포션');
  await cast(c, e, '커피 메테오');
  await cast(d, e, '축하 폭죽');
  await expect(e.page.getByText('동료들의 전설의 응원을 받았어요!')).toBeVisible();
  await expect.poll(async () => spellSounds(await sfxPlayed(e.page))).toContain('spell.raid');
  await expect.poll(async () => (await fxStrips(b.page))['spell/raid-pillar'] ?? 0).toBeGreaterThan(0);
});

test('마법 받지 않기 closes the spellbook for everyone', async () => {
  await d.page.goto('/me?tab=settings');
  const refuse = d.page.getByRole('checkbox', { name: /마법 받지 않기/ });
  await d.page.getByText('마법 받지 않기', { exact: true }).click();
  await expect(refuse).toBeChecked();
  await d.page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(d.page.getByText('저장했어요', { exact: true })).toBeVisible();
  await a.page.reload();
  await waitForTownState(a.page);
  const menu = await openMenuFromRail(a.page, d.name);
  await expect(menu.getByRole('menuitem', { name: '응원 파이어볼' })).toBeDisabled();
  await expect(menu.getByText('마법을 받지 않아요')).toBeVisible();
  await a.page.keyboard.press('Escape');
  // Accept spells again for later specs.
  await d.page.getByText('마법 받지 않기', { exact: true }).click();
  await expect(refuse).not.toBeChecked();
  await d.page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(d.page.getByText('저장했어요', { exact: true })).toBeVisible();
});

test('the messenger casts too, and someone with only the messenger open is spelled', async () => {
  // e keeps only the messenger open (still drawn in the town: ENU Den is open); b casts from e's page.
  await e.page.goto('/');
  await wakeSound(e.page);
  await b.page.goto(`/people/${e.userId}`);
  await wakeSound(b.page);
  await b.page.getByRole('button', { name: /마법/ }).click();
  const book = b.page.getByRole('dialog', { name: '직원02님에게 마법 쓰기' });
  const coffee = book.getByRole('button', { name: '커피 메테오' });
  await expect(coffee).toBeEnabled();
  await coffee.click();
  await expect(b.page.getByText('직원02님에게 커피 메테오!')).toBeVisible();
  await expect(e.page.getByText('직원03님의 커피 메테오!')).toBeVisible();
  await expect.poll(async () => spellSounds(await sfxPlayed(b.page))).toContain('cast.coffee');
  await expect.poll(async () => spellSounds(await sfxPlayed(e.page))).toContain('hit.coffee');
});
