import { beforeEach, describe, expect, it, vi } from 'vitest';

// A browser-ish global for the prefs (localStorage) and the engine's listeners.
const store = new Map<string, string>();
(globalThis as unknown as { window: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  },
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
};

const { SoundEngine, MAX_VOICES, SAME_ID_GAP_MS } = await import('./engine');
const { setSoundPrefs } = await import('./prefs');

class FakeCtx {
  static last: FakeCtx | null = null;
  state = 'running';
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
    return Promise.resolve();
  }
}

function engine(hidden = false, now = { t: 0 }) {
  return new SoundEngine({
    now: () => now.t,
    hidden: () => hidden,
    audioContext: () => FakeCtx as unknown as new () => AudioContext,
  });
}

describe('SoundEngine', () => {
  beforeEach(() => {
    store.clear();
    setSoundPrefs({ on: true, level: 'low' });
    vi.useFakeTimers();
  });

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
