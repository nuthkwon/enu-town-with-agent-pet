import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A browser-ish global for the prefs (localStorage) and the engine's listeners.
const store = new Map<string, string>();
type Listener = (e: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
  addEventListener: (type: string, fn: Listener) => {
    listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
  },
  removeEventListener: (type: string, fn: Listener) => {
    listeners.get(type)?.delete(fn);
    if (listeners.get(type)?.size === 0) listeners.delete(type);
  },
};

/** An element on the page; the speaker button carries `data-sound-state` (SoundToggle). */
class FakeElement {
  constructor(private readonly speaker = false) {}
  closest(selector: string): FakeElement | null {
    return this.speaker && selector === '[data-sound-state]' ? this : null;
  }
}
(globalThis as unknown as { Element: unknown }).Element = FakeElement;

/** The browser's autoplay rule: a context starts (or resumes) only while the page has user activation. */
let activated = true;

const { SoundEngine, MAX_VOICES, SAME_ID_GAP_MS } = await import('./engine');
const { setSoundPrefs } = await import('./prefs');

class FakeCtx {
  static last: FakeCtx | null = null;
  state = activated ? 'running' : 'suspended';
  sampleRate = 8000;
  currentTime = 0;
  destination = {};
  started: string[] = [];
  stopped = 0;
  constructor() {
    FakeCtx.last = this;
  }
  createGain() {
    return { gain: { setValueAtTime: vi.fn() }, connect: () => undefined };
  }
  createBuffer(_ch: number, length: number) {
    return { length, copyToChannel: () => undefined, id: '' };
  }
  createBufferSource() {
    const src: Record<string, unknown> = {
      buffer: null,
      onended: null,
      connect: () => undefined,
      disconnect: () => undefined,
      start: () => this.started.push('x'),
      stop: () => {
        this.stopped++;
      },
    };
    return src;
  }
  addEventListener() {}
  resume() {
    if (activated) this.state = 'running';
    return Promise.resolve();
  }
}

function engine(hidden = false, now = { t: 0 }) {
  return new SoundEngine({
    now: () => now.t,
    hidden: () => hidden,
    userActive: () => activated,
    audioContext: () => FakeCtx as unknown as new () => AudioContext,
  });
}

beforeEach(() => {
  store.clear();
  setSoundPrefs({ on: true, level: 'low' });
  FakeCtx.last = null;
  activated = true;
  vi.useFakeTimers();
});

describe('SoundEngine', () => {
  it('drops sounds until the first gesture unlocks audio, then plays', () => {
    const e = engine();
    expect(e.play('ui.tap')).toBe(false);
    expect(e.state).toBe('locked');
    e.unlock();
    expect(e.state).toBe('on');
    expect(e.play('ui.tap')).toBe(true);
    expect(FakeCtx.last!.started.length).toBe(1);
  });

  it('is silent when turned off', () => {
    const e = engine();
    e.unlock();
    setSoundPrefs({ on: false });
    expect(e.state).toBe('off');
    expect(e.play('hit.fireball')).toBe(false);
  });

  it('drops the same sound again within the repeat gap', () => {
    const now = { t: 1000 };
    const e = engine(false, now);
    e.unlock();
    expect(e.play('ui.tap')).toBe(true);
    now.t += SAME_ID_GAP_MS - 1;
    expect(e.play('ui.tap')).toBe(false);
    now.t += 2;
    expect(e.play('ui.tap')).toBe(true);
  });

  it('keeps at most a few voices (the oldest stops)', () => {
    const e = engine();
    e.unlock();
    const ids = ['ui.tap', 'ui.on', 'msg.send', 'popup.open', 'popup.close', 'wave.out'] as const;
    for (const id of ids) e.play(id);
    expect(FakeCtx.last!.started.length).toBe(ids.length);
    expect(FakeCtx.last!.stopped).toBe(ids.length - MAX_VOICES);
  });

  it('in a background tab only a call and a DM ring, at most once per gap', () => {
    const now = { t: 0 };
    const e = engine(true, now);
    e.unlock();
    expect(e.play('hit.fireball')).toBe(false);
    expect(e.play('ping.in')).toBe(true);
    now.t += 5000;
    expect(e.play('ping.in')).toBe(false);
    now.t += 5001;
    expect(e.play('ping.in')).toBe(true);
    expect(e.play('dm.in')).toBe(true);
  });
});

interface Init {
  target?: FakeElement;
  pointerType?: string;
  key?: string;
}
type Step = [type: string, init: Init];

/** HTML's activation-triggering input events: from one of these on, the browser lets the page start audio. */
function triggersActivation([type, init]: Step): boolean {
  if (type === 'keydown') return init.key !== 'Escape';
  if (type === 'pointerdown') return init.pointerType === 'mouse';
  if (type === 'pointerup') return init.pointerType !== 'mouse';
  return type === 'touchend';
}

/**
 * Dispatches one gesture's events in the browser's order to the window's capture listeners (the engine's, which
 * run before the page's own). `onClick` is the pressed element's click handler, which runs after them.
 */
function gesture(steps: Step[], onClick?: () => void): void {
  for (const step of steps) {
    if (triggersActivation(step)) activated = true;
    const [type, init] = step;
    const e = {
      type,
      target: init.target ?? new FakeElement(),
      pointerType: init.pointerType,
      key: init.key,
    };
    for (const fn of [...(listeners.get(type) ?? [])]) fn(e);
    if (type === 'click') onClick?.();
  }
  activated = false; // the next gesture starts without it
}

const mouseClick = (target?: FakeElement): Step[] => [
  ['pointerdown', { pointerType: 'mouse', target }],
  ['pointerup', { pointerType: 'mouse', target }],
  ['click', { target }],
];
const touchTap = (target?: FakeElement): Step[] => [
  ['pointerdown', { pointerType: 'touch', target }],
  ['pointerup', { pointerType: 'touch', target }],
  ['touchend', { target }],
  ['click', { target }],
];
const penTap = (target?: FakeElement): Step[] => [
  ['pointerdown', { pointerType: 'pen', target }],
  ['pointerup', { pointerType: 'pen', target }],
  ['click', { target }],
];
const enterKey = (target?: FakeElement): Step[] => [
  ['keydown', { key: 'Enter', target }],
  ['click', { target }],
];
const spaceKey = (target?: FakeElement): Step[] => [
  ['keydown', { key: ' ', target }],
  ['keyup', { key: ' ', target }],
  ['click', { target }],
];

describe('waking the sound (browsers start audio only from a gesture)', () => {
  const offs: (() => void)[] = [];
  /** An engine listening the way a mounted shell does, before any gesture. */
  function listening() {
    const e = engine();
    offs.push(e.install());
    return e;
  }

  beforeEach(() => {
    activated = false;
  });
  afterEach(() => {
    for (const off of offs.splice(0)) off();
  });

  const firsts: [string, Step[]][] = [
    ['mouse click', mouseClick()],
    ['tap on a touch screen', touchTap()],
    ['pen tap', penTap()],
    ['key press', enterKey()],
  ];
  for (const [name, steps] of firsts)
    it(`the first ${name} anywhere wakes it`, () => {
      const e = listening();
      expect(e.state).toBe('locked');
      gesture(steps);
      expect(e.state).toBe('on');
      expect(e.play('ui.tap')).toBe(true);
    });

  it('a touch pointerdown does not (the context would stay suspended) unless the page is already activated', () => {
    const e = listening();
    gesture([['pointerdown', { pointerType: 'touch' }]]);
    expect(FakeCtx.last).toBeNull();
    expect(e.state).toBe('locked');
    activated = true; // a tap a moment ago
    gesture([['pointerdown', { pointerType: 'touch' }]]);
    expect(e.state).toBe('on');
  });

  it('a key the browser does not count leaves it locked, and the next gesture resumes it', () => {
    const e = listening();
    gesture([['keydown', { key: 'Escape' }]]);
    expect(e.state).toBe('locked');
    gesture(touchTap());
    expect(e.state).toBe('on');
  });

  const presses: [string, (target: FakeElement) => Step[]][] = [
    ['mouse', mouseClick],
    ['touch', touchTap],
    ['Enter', enterKey],
    ['Space', spaceKey],
  ];
  for (const [name, press] of presses)
    it(`pressing the speaker button (${name}) while it shows locked wakes the sound; again turns it off`, () => {
      const e = listening();
      const speaker = new FakeElement(true);
      // SoundToggle's onClick, reading the state it shows (React re-renders on every engine change before a click).
      const onClick = () => e.pressSpeaker(e.state);
      gesture(press(speaker), onClick);
      expect(e.state).toBe('on');
      expect(e.debug!.played.map((p) => p.id)).toEqual(['ui.on']);
      gesture(press(speaker), onClick);
      expect(e.state).toBe('off');
      gesture(press(speaker), onClick);
      expect(e.state).toBe('on');
    });

  it('listens for every gesture once for both shells and stops with the last one', () => {
    const e = engine();
    offs.push(e.install(), e.install());
    expect([...listeners.keys()].sort()).toEqual([
      'click',
      'keydown',
      'pointerdown',
      'pointerup',
      'storage',
      'touchend',
    ]);
    for (const set of listeners.values()) expect(set.size).toBe(1);
    offs.shift()!();
    expect(listeners.size).toBe(6);
    offs.shift()!();
    expect(listeners.size).toBe(0);
  });
});
