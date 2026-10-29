import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  SKIN_TONES,
  avatarSpriteKey,
  type AvatarPreset,
} from '@enu/shared';

/** Browser-safe avatar key helpers (the key format is defined by avatarSpriteKey in @enu/shared). */

const has = <T extends string>(values: readonly T[], v: string | undefined): v is T =>
  v !== undefined && (values as readonly string[]).includes(v);

/**
 * Parses "av-{body}-{hair}-{hairColor}-{outfit}-{skin}[-w]" strictly against the shared enums.
 * Returns null for anything else (including keys that would not round-trip exactly).
 */
export function parseAvatarKey(key: string): AvatarPreset | null {
  if (key.length > 64) return null;
  const parts = key.split('-');
  if (parts.length !== 6 && parts.length !== 7) return null;
  const [prefix, body, hair, hairColor, outfit, skin, wings] = parts;
  if (prefix !== 'av') return null;
  if (!has(BODY_TYPES, body) || !has(HAIR_STYLES, hair) || !has(HAIR_COLORS, hairColor)) return null;
  if (!has(OUTFIT_COLORS, outfit) || !has(SKIN_TONES, skin)) return null;
  if (wings !== undefined && wings !== 'w') return null;
  const preset: AvatarPreset = { body, hair, hairColor, outfit, skin, wings: wings === 'w' };
  return avatarSpriteKey(preset) === key ? preset : null;
}

/** URL of the generated sprite sheet for a preset (served by /api/sprites/avatar/[key]). */
export function avatarSheetUrl(preset: AvatarPreset): string {
  return `/api/sprites/avatar/${avatarSpriteKey(preset)}`;
}
