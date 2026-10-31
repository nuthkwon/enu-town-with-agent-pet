import { SPELLS } from '@enu/shared';
import { describe, expect, it } from 'vitest';
import {
  CATEGORY_TARGETS,
  RECIPES,
  SFX_IDS,
  checkRecipe,
  decodeWav,
  encodeWav,
  measureLufs,
  noteName,
  pitchTrack,
  renderRecipe,
  renderSfx,
  type SfxRecipe,
} from '../src/index';

const sine = (hz: number, seconds: number, fs: number, amp = 1) =>
  Float32Array.from(
    { length: Math.round(seconds * fs) },
    (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / fs),
  );

describe('loudness meter (BS.1770)', () => {
  it('reads a full-scale 997 Hz sine as -3.01 LUFS at 48 and 44.1 kHz', () => {
    expect(measureLufs(sine(997, 3, 48_000), 48_000)).toBeCloseTo(-3.01, 1);
    expect(measureLufs(sine(997, 3, 44_100), 44_100)).toBeCloseTo(-3.01, 1);
  });

  it('drops 20 LU for a 20 dB quieter sine and reads silence as -Infinity', () => {
    expect(measureLufs(sine(997, 3, 48_000, 0.1), 48_000)).toBeCloseTo(-23.01, 1);
    expect(measureLufs(new Float32Array(48_000), 48_000)).toBe(-Infinity);
  });

  it('measures a sound shorter than one block over its own length', () => {
    expect(measureLufs(sine(997, 0.1, 48_000), 48_000)).toBeCloseTo(-3.01, 0);
  });
});

describe('every sound', () => {
  it.each(SFX_IDS)('%s passes the check', (id) => {
    expect(checkRecipe(RECIPES[id]).errors).toEqual([]);
  });

  it('has one line of description and a known category', () => {
    for (const id of SFX_IDS) {
      const r: SfxRecipe = RECIPES[id];
      expect(r.desc.length, id).toBeGreaterThan(10);
      expect(r.desc.length, id).toBeLessThanOrEqual(140);
      expect(Object.keys(CATEGORY_TARGETS), id).toContain(r.category);
    }
  });

  it('includes a cast and a hit for each of the six spells', () => {
    for (const s of SPELLS) {
      expect(SFX_IDS).toContain(`cast.${s}`);
      expect(SFX_IDS).toContain(`hit.${s}`);
    }
  });

  it('renders the same samples every time', () => {
    const a = renderSfx('spell.raid', 48_000);
    const b = renderSfx('spell.raid', 48_000);
    expect(Buffer.from(a.buffer).equals(Buffer.from(b.buffer))).toBe(true);
  });
});

describe('analysis', () => {
  it('hears the doorbell of ping.in as E6 then C6', () => {
    const track = pitchTrack(renderSfx('ping.in', 48_000), 48_000).map((p) => noteName(p.hz));
    const e6 = track.indexOf('E6');
    const c6 = track.lastIndexOf('C6');
    expect(e6).toBeGreaterThanOrEqual(0);
    expect(c6).toBeGreaterThan(e6);
  });

  it('names notes', () => {
    expect(noteName(440)).toBe('A4');
    expect(noteName(261.63)).toBe('C4');
    expect(noteName(1318.51)).toBe('E6');
  });
});

describe('wav', () => {
  it('round-trips 16-bit PCM', () => {
    const x = renderRecipe(RECIPES['ui.tap'], 44_100);
    const { fs, samples } = decodeWav(encodeWav(x, 44_100));
    expect(fs).toBe(44_100);
    expect(samples.length).toBe(x.length);
    for (let i = 0; i < x.length; i++)
      expect(Math.abs(samples[i]! - x[i]!)).toBeLessThanOrEqual(1 / 32_767 + 1e-6);
  });
});
