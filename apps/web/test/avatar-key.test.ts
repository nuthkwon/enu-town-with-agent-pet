import {
  BODY_TYPES,
  DEFAULT_AVATAR,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  SKIN_TONES,
  avatarSpriteKey,
} from '@enu/shared';
import { describe, expect, it } from 'vitest';
import { isAvatarKey } from '@/game/assets';
import { SPRITE_REVISION } from '@/game/spriteSpec';
import { avatarSheetUrl, parseAvatarKey } from '@/lib/avatar-key';

describe('parseAvatarKey', () => {
  it('round-trips every enum value', () => {
    for (const body of BODY_TYPES)
      for (const hair of HAIR_STYLES)
        for (const hairColor of HAIR_COLORS)
          for (const outfit of OUTFIT_COLORS)
            for (const skin of SKIN_TONES)
              for (const wings of [false, true])
                for (const hat of [true, false]) {
                  const preset = { body, hair, hairColor, outfit, skin, wings, hat };
                  expect(parseAvatarKey(avatarSpriteKey(preset))).toEqual(preset);
                }
  });

  it('parses the default avatar and the wings and no-hat suffixes', () => {
    expect(parseAvatarKey('av-m-short-black-sky-warm')).toEqual(DEFAULT_AVATAR);
    expect(parseAvatarKey('av-f-bob-pink-rose-light-w')).toEqual({
      body: 'f',
      hair: 'bob',
      hairColor: 'pink',
      outfit: 'rose',
      skin: 'light',
      wings: true,
      hat: true,
    });
    expect(parseAvatarKey('av-f-bob-pink-rose-light-w-n')?.hat).toBe(false);
    expect(parseAvatarKey('av-f-bob-pink-rose-light-n')).toMatchObject({ wings: false, hat: false });
    // the suffixes come in one order only
    expect(parseAvatarKey('av-f-bob-pink-rose-light-n-w')).toBeNull();
  });

  it('rejects anything not exactly in the shared enums', () => {
    for (const key of [
      '',
      'av',
      'xv-m-short-black-sky-warm',
      'av-x-short-black-sky-warm',
      'av-m-mohawk-black-sky-warm',
      'av-m-short-green-sky-warm',
      'av-m-short-black-gold-warm',
      'av-m-short-black-sky-purple',
      'av-m-short-black-sky-warm-x',
      'av-m-short-black-sky-warm-w-w',
      'AV-M-SHORT-BLACK-SKY-WARM',
      'av-m-short-black-sky-warm.png',
      '../../etc/passwd',
      `av-m-short-black-sky-warm${'-w'.repeat(40)}`,
    ]) {
      expect(parseAvatarKey(key), key).toBeNull();
    }
  });

  it('builds the sheet URL from the shared key, with the sprite revision', () => {
    expect(avatarSheetUrl(DEFAULT_AVATAR)).toBe(
      `/api/sprites/avatar/av-m-short-black-sky-warm?r=${SPRITE_REVISION}`,
    );
    expect(avatarSheetUrl({ ...DEFAULT_AVATAR, wings: true, hat: false })).toBe(
      `/api/sprites/avatar/av-m-short-black-sky-warm-w-n?r=${SPRITE_REVISION}`,
    );
  });

  it('lets the town load every key the shared format produces (wings and no-hat suffixes too)', () => {
    for (const hair of HAIR_STYLES)
      for (const wings of [false, true])
        for (const hat of [true, false]) {
          const key = avatarSpriteKey({ ...DEFAULT_AVATAR, hair, wings, hat });
          expect(isAvatarKey(key), key).toBe(true);
        }
    expect(isAvatarKey('av-m-short-black-sky-warm-n-w')).toBe(false);
    expect(isAvatarKey('av-m-short-black-sky-warm-x')).toBe(false);
  });
});
