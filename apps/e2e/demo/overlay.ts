import type { BrowserContext, Locator, Page } from '@playwright/test';

/**
 * In-page props for the demo video, injected only into the demo's own browser contexts (never part of the
 * app): a visible mouse pointer with click ripples, full-screen title cards and a terminal window for the
 * steps a person types on their own computer. State survives navigations through sessionStorage.
 */
interface OverlayState {
  card: { title: string; lines: string[] } | null;
  terminal: { title: string; lines: string[] } | null;
  pointer: { x: number; y: number };
}

declare global {
  interface Window {
    __demo?: {
      set(patch: Partial<OverlayState>): void;
    };
  }
}

/** Runs in the page before any app script (serialized by Playwright: no outside references). */
function overlayInit(): void {
  const KEY = 'den-demo-overlay';
  const read = (): OverlayState => {
    try {
      const raw = sessionStorage.getItem(KEY);
      if (raw) return JSON.parse(raw) as OverlayState;
    } catch {
      // first load
    }
    return { card: null, terminal: null, pointer: { x: -100, y: -100 } };
  };
  let state = read();
  const save = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  };

  const css = `
    nextjs-portal { display: none !important; }
    #demo-pointer { position: fixed; z-index: 2147483647; width: 26px; height: 26px; margin: -3px 0 0 -3px;
      pointer-events: none; transition: transform 80ms ease-out; filter: drop-shadow(0 2px 3px rgba(40, 20, 80, .35)); }
    #demo-pointer.down { transform: scale(.85); }
    .demo-ripple { position: fixed; z-index: 2147483646; width: 44px; height: 44px; margin: -22px 0 0 -22px;
      border-radius: 50%; border: 3px solid rgba(155, 109, 255, .9); pointer-events: none;
      animation: demo-ripple 600ms ease-out forwards; }
    @keyframes demo-ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.4); opacity: 0 } }
    #demo-card { position: fixed; inset: 0; z-index: 2147483640; display: flex; flex-direction: column;
      align-items: center; justify-content: center; gap: 22px; padding: 60px;
      background: radial-gradient(circle at 30% 20%, #ffffff 0%, #f1e9ff 45%, #fde6f3 100%);
      color: #3b2f4a; font-family: 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif; text-align: center; }
    #demo-card h1 { margin: 0; font-family: 'Galmuri11', 'Noto Sans CJK KR', sans-serif; font-size: 64px;
      color: #6b4fd8; letter-spacing: .02em; }
    #demo-card p { margin: 0; font-size: 30px; line-height: 1.55; max-width: 1400px; }
    #demo-card p.small { font-size: 22px; color: #76688c; }
    #demo-card ul { margin: 6px 0 0; padding: 0; list-style: none; font-size: 28px; line-height: 1.7; text-align: left; }
    #demo-card li::before { content: '✦ '; color: #9b6dff; }
    #demo-term { position: fixed; z-index: 2147483641; right: 36px; bottom: 36px; width: 760px;
      border-radius: 12px; overflow: hidden; box-shadow: 0 18px 48px rgba(30, 16, 60, .35);
      font-family: 'DejaVu Sans Mono', 'Noto Sans Mono CJK KR', monospace; font-size: 20px; }
    #demo-term .bar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: #2d2640; color: #cfc6e8;
      font-family: 'Noto Sans CJK KR', sans-serif; font-size: 16px; }
    #demo-term .dot { width: 12px; height: 12px; border-radius: 50%; background: #ff6b6b; }
    #demo-term .dot:nth-child(2) { background: #ffd166; } #demo-term .dot:nth-child(3) { background: #5ccf86; }
    #demo-term pre { margin: 0; padding: 16px 18px 20px; min-height: 150px; background: #1d1830; color: #e9e4ff;
      white-space: pre-wrap; line-height: 1.5; font: inherit; }
  `;

  const pointerSvg =
    '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M3 2 L3 20 L8 15 L11.5 22 L14.5 20.6 L11 13.8 L18 13.8 Z" ' +
    'fill="#ffffff" stroke="#3b2f4a" stroke-width="1.6" stroke-linejoin="round"/></svg>';

  const render = () => {
    const root = document.body;
    if (!root) return;
    let pointer = document.getElementById('demo-pointer');
    if (!pointer) {
      pointer = document.createElement('div');
      pointer.id = 'demo-pointer';
      pointer.innerHTML = pointerSvg;
      root.appendChild(pointer);
    }
    pointer.style.left = `${state.pointer.x}px`;
    pointer.style.top = `${state.pointer.y}px`;

    let card = document.getElementById('demo-card');
    if (state.card) {
      if (!card) {
        card = document.createElement('div');
        card.id = 'demo-card';
        root.appendChild(card);
      }
      card.replaceChildren();
      const h = document.createElement('h1');
      h.textContent = state.card.title;
      card.appendChild(h);
      const bullets = state.card.lines.filter((l) => l.startsWith('- '));
      for (const line of state.card.lines.filter((l) => !l.startsWith('- '))) {
        const p = document.createElement('p');
        if (line.startsWith('~ ')) p.className = 'small';
        p.textContent = line.replace(/^~ /, '');
        card.appendChild(p);
      }
      if (bullets.length) {
        const ul = document.createElement('ul');
        for (const b of bullets) {
          const li = document.createElement('li');
          li.textContent = b.slice(2);
          ul.appendChild(li);
        }
        card.appendChild(ul);
      }
    } else card?.remove();

    let term = document.getElementById('demo-term');
    if (state.terminal) {
      if (!term) {
        term = document.createElement('div');
        term.id = 'demo-term';
        term.innerHTML =
          '<div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span><span class="t"></span></div><pre></pre>';
        root.appendChild(term);
      }
      (term.querySelector('.t') as HTMLElement).textContent = state.terminal.title;
      (term.querySelector('pre') as HTMLElement).textContent = state.terminal.lines.join('\n');
    } else term?.remove();
  };

  const boot = () => {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    render();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.addEventListener(
    'mousemove',
    (e) => {
      state.pointer = { x: e.clientX, y: e.clientY };
      const p = document.getElementById('demo-pointer');
      if (p) {
        p.style.left = `${e.clientX}px`;
        p.style.top = `${e.clientY}px`;
      }
    },
    true,
  );
  window.addEventListener(
    'mousedown',
    (e) => {
      document.getElementById('demo-pointer')?.classList.add('down');
      const r = document.createElement('div');
      r.className = 'demo-ripple';
      r.style.left = `${e.clientX}px`;
      r.style.top = `${e.clientY}px`;
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 700);
    },
    true,
  );
  window.addEventListener(
    'mouseup',
    () => document.getElementById('demo-pointer')?.classList.remove('down'),
    true,
  );
  window.addEventListener('beforeunload', save);

  window.__demo = {
    set(patch) {
      state = { ...state, ...patch };
      save();
      render();
    },
  };
}

export async function installOverlay(context: BrowserContext): Promise<void> {
  await context.addInitScript(overlayInit);
}

export async function showCard(page: Page, title: string, lines: string[]): Promise<void> {
  await page.evaluate(
    ([t, l]) => window.__demo?.set({ card: { title: t as string, lines: l as string[] } }),
    [title, lines],
  );
}

export async function hideCard(page: Page): Promise<void> {
  await page.evaluate(() => window.__demo?.set({ card: null }));
}

/** Types the lines into the terminal window one character at a time (what the person types themselves). */
export async function terminal(page: Page, title: string, lines: string[], charDelayMs = 45): Promise<void> {
  const shown: string[] = [];
  for (const line of lines) {
    shown.push('');
    const typed = line.startsWith('$ ');
    for (let i = 1; i <= line.length; i += typed ? 1 : line.length) {
      shown[shown.length - 1] = line.slice(0, i);
      await page.evaluate(
        ([t, l]) => window.__demo?.set({ terminal: { title: t as string, lines: l as string[] } }),
        [title, shown],
      );
      if (typed) await page.waitForTimeout(charDelayMs);
    }
    await page.waitForTimeout(typed ? 500 : 900);
  }
}

export async function hideTerminal(page: Page): Promise<void> {
  await page.evaluate(() => window.__demo?.set({ terminal: null }));
}

/** Glides the pointer to the middle of `target` (so viewers can follow it), then clicks. */
export async function glideClick(
  page: Page,
  target: Locator,
  opts: { pauseMs?: number } = {},
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('glideClick: target has no box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 28 });
  await page.waitForTimeout(opts.pauseMs ?? 350);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** Moves the pointer over `target` without clicking (pointing something out). */
export async function glideTo(page: Page, target: Locator, dx = 0, dy = 0): Promise<void> {
  const box = await target.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 30 });
}

/** Clicks a field and types like a person (the app sees ordinary key events). */
export async function typeInto(page: Page, field: Locator, text: string, delayMs = 55): Promise<void> {
  await glideClick(page, field);
  await field.pressSequentially(text, { delay: delayMs });
}
