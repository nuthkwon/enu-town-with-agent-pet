import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the town page. The canvas is read through the dev/e2e debug hook that WorldScene installs
 * outside production (`window.__ENU_DEN_DEBUG__`), so tests never guess pixels.
 */

export interface PlayerState {
  shown: boolean;
  online: boolean;
  activity: number;
  source: number;
  until: number;
  note: number;
  groupId: string;
  statusText: string;
  deskId: string;
}

export interface PlateState {
  kind: 'seated' | 'elsewhere' | 'hidden' | 'vacant';
  lines: string[];
  online: boolean;
}

interface Point {
  x: number;
  y: number;
}

interface DebugHook {
  avatarScreen(userId: string): Point | null;
  playerTile(userId: string): Point | null;
  playerState(userId: string): PlayerState | null;
  plate(deskId: string): PlateState | null;
  plateRects(): { deskId: string; x: number; y: number; w: number; h: number }[];
  tileScreen(tx: number, ty: number): Point;
  zoom(): number;
  fitZoom(): number;
  officeOpen(): boolean | null;
  avatarCount(): number;
  fxDrawn(): { wave: number; plane: number };
  petBubble(): PetBubbleState | null;
  petState(ownerId: string): PetState | null;
}

/** The viewer's own pet bubble as drawn on the canvas. */
export interface PetBubbleState {
  bubbleId: string;
  text: string;
  kind: number;
  dueAt: number;
}

/** Someone's pet as the viewer's client decoded it. */
export interface PetState {
  bubbleId: string;
  bubbleText: string;
  bubbleUntil: number;
  indicator: number;
}

declare global {
  interface Window {
    __ENU_DEN_DEBUG__?: DebugHook;
  }
}

/** Waits until the scene is up and the room state has arrived (the 14 roster actors are always there). */
export async function waitForTownState(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__ENU_DEN_DEBUG__?.officeOpen() === true, null, {
    timeout: 90_000,
  });
}

/** My own pet's bubble as drawn on the canvas (null while none is visible). */
export function petBubble(page: Page): Promise<PetBubbleState | null> {
  return page.evaluate(() => window.__ENU_DEN_DEBUG__?.petBubble() ?? null);
}

/** Someone's pet as this page decoded it from the room state. */
export function petState(page: Page, ownerId: string): Promise<PetState | null> {
  return page.evaluate((id) => window.__ENU_DEN_DEBUG__?.petState(id) ?? null, ownerId);
}

export function playerState(page: Page, userId: string): Promise<PlayerState | null> {
  return page.evaluate((id) => window.__ENU_DEN_DEBUG__?.playerState(id) ?? null, userId);
}

export function playerTile(page: Page, userId: string): Promise<Point | null> {
  return page.evaluate((id) => window.__ENU_DEN_DEBUG__?.playerTile(id) ?? null, userId);
}

export function plate(page: Page, deskId: string): Promise<PlateState | null> {
  return page.evaluate((id) => window.__ENU_DEN_DEBUG__?.plate(id) ?? null, deskId);
}

export function zoom(page: Page): Promise<number> {
  return page.evaluate(() => window.__ENU_DEN_DEBUG__?.zoom() ?? 0);
}

export function fxDrawn(page: Page): Promise<{ wave: number; plane: number }> {
  return page.evaluate(() => window.__ENU_DEN_DEBUG__?.fxDrawn() ?? { wave: 0, plane: 0 });
}

/** Clicks a map tile (screen position from the debug hook). */
export async function clickTile(page: Page, tx: number, ty: number): Promise<void> {
  const box = await page.locator('canvas').first().boundingBox();
  const p = await page.evaluate(([x, y]) => window.__ENU_DEN_DEBUG__!.tileScreen(x!, y!), [tx, ty]);
  if (!box) throw new Error('no canvas');
  await page.mouse.click(box.x + p.x, box.y + p.y);
}

/** The docked team rail (>= 1280 px): the accessible mirror of the map. */
export function rail(page: Page): Locator {
  return page.getByRole('region', { name: '사람들 목록 (지도와 같은 내용)' });
}

/** One person's row in the team rail. */
export function railRow(page: Page, displayName: string): Locator {
  return rail(page).getByRole('button', { name: new RegExp(`^${displayName}`) });
}

/** Opens a colleague's menu from their team-rail row (same menu as clicking the avatar or desk). */
export async function openMenuFromRail(page: Page, displayName: string): Promise<Locator> {
  await railRow(page, displayName).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}

/** StatusMenu option label -> the short form on the top-bar chip (`내 상태: 집중 ~11:00`). */
const STATUS_SHORT: Record<string, string> = {
  '자동 (일정·Claude·업무 기록 기준)': '자동',
  '대화 가능': '대화 가능',
  '집중 모드': '집중',
  '회의 중': '회의 중',
  휴식: '휴식',
  '자리 비움': '자리 비움',
};

/** 내 상태: picks a status (and a duration) in the StatusMenu, applies it and waits for the top-bar chip. */
export async function setMyStatus(page: Page, option: string, duration?: string): Promise<void> {
  const chip = page.locator('[data-town-me]');
  await chip.click();
  const dialog = page.getByRole('dialog', { name: '내 상태' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: option }).check();
  const durations = dialog.getByRole('group', { name: '언제까지' });
  if (option.startsWith('자동')) await expect(durations).toHaveCount(0);
  else await expect(durations).toBeVisible();
  if (duration) await durations.getByRole('button', { name: duration, exact: true }).click();
  await dialog.getByRole('button', { name: '적용' }).click();
  await expect(dialog).toBeHidden();
  await expect(chip).toHaveAttribute('aria-label', new RegExp(`내 상태: ${STATUS_SHORT[option] ?? option}`));
}

/**
 * Records the type of every room message this page sends (Colyseus ROOM_DATA frames: protocol byte 13,
 * then the type as a msgpack string). Returns the live list.
 */
export function spyRoomMessages(page: Page): string[] {
  const types: string[] = [];
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      const buf = typeof frame.payload === 'string' ? Buffer.from(frame.payload, 'binary') : frame.payload;
      if (buf.length < 2 || buf[0] !== 13) return;
      const b = buf[1]!;
      let len = -1;
      let at = 2;
      if ((b & 0xe0) === 0xa0) len = b & 0x1f;
      else if (b === 0xd9) {
        len = buf[2] ?? -1;
        at = 3;
      }
      types.push(len >= 0 ? buf.subarray(at, at + len).toString('utf8') : `#${b}`);
    });
  });
  return types;
}
