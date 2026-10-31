import { describe, expect, it } from 'vitest';
import { DEFAULT_SOUND_PREFS, parseSoundPrefs } from './prefs';

describe('sound prefs (this browser only)', () => {
  it('are on and quiet by default', () => {
    expect(DEFAULT_SOUND_PREFS).toEqual({ on: true, level: 'low' });
    expect(parseSoundPrefs(null)).toEqual(DEFAULT_SOUND_PREFS);
  });

  it('read back what was stored and ignore anything else', () => {
    expect(parseSoundPrefs('{"on":false,"level":"high"}')).toEqual({ on: false, level: 'high' });
    expect(parseSoundPrefs('{"on":"yes","level":"loud"}')).toEqual(DEFAULT_SOUND_PREFS);
    expect(parseSoundPrefs('not json')).toEqual(DEFAULT_SOUND_PREFS);
  });
});
