'use client';

import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  OUTFIT_COLORS,
  SKIN_TONES,
  type AvatarPreset,
  type HairColor,
  type OutfitColor,
  type SkinTone,
} from '@enu/shared';
import { ko } from '@/i18n/ko';
import { Segmented, Toggle } from './ui';
import { AvatarSprite, SpriteStage } from './sprites';
import s from './editors.module.css';

/** Base colours per option (from @enu/sprites AVATAR_SWATCHES, passed down by the server page). */
export interface AvatarSwatches {
  hair: Record<HairColor, string>;
  outfit: Record<OutfitColor, string>;
  skin: Record<SkinTone, string>;
}

const t = ko.avatarEditor;

export function AvatarEditor({
  value,
  onChange,
  swatches,
}: {
  value: AvatarPreset;
  onChange: (next: AvatarPreset) => void;
  swatches: AvatarSwatches;
}) {
  const set = <K extends keyof AvatarPreset>(k: K, v: AvatarPreset[K]) => onChange({ ...value, [k]: v });

  return (
    <div className={s.editor}>
      <div className={s.previewCol}>
        <SpriteStage size={176}>
          <AvatarSprite preset={value} scale={4} animate label={t.preview} />
        </SpriteStage>
        <span className={s.previewLabel}>{t.preview}</span>
      </div>

      <div className={s.controls}>
        <div className={s.group}>
          <span className={s.groupLabel}>{t.body}</span>
          <Segmented
            label={t.body}
            value={value.body}
            options={BODY_TYPES.map((b) => ({ value: b, label: t.bodyLabel[b] }))}
            onChange={(v) => set('body', v)}
          />
        </div>

        <div className={s.group}>
          <span className={s.groupLabel}>{t.hair}</span>
          <div className={s.chips} role="group" aria-label={t.hair}>
            {HAIR_STYLES.map((h) => (
              <button key={h} type="button" className={s.chip} aria-pressed={value.hair === h} onClick={() => set('hair', h)}>
                {t.hairLabel[h]}
              </button>
            ))}
          </div>
        </div>

        <SwatchGroup
          label={t.hairColor}
          values={HAIR_COLORS}
          current={value.hairColor}
          colors={swatches.hair}
          names={t.hairColorLabel}
          onPick={(v) => set('hairColor', v)}
        />
        <SwatchGroup
          label={t.outfit}
          values={OUTFIT_COLORS}
          current={value.outfit}
          colors={swatches.outfit}
          names={t.outfitLabel}
          onPick={(v) => set('outfit', v)}
        />
        <SwatchGroup
          label={t.skin}
          values={SKIN_TONES}
          current={value.skin}
          colors={swatches.skin}
          names={t.skinLabel}
          onPick={(v) => set('skin', v)}
        />

        <Toggle checked={value.wings} onChange={(v) => set('wings', v)} label={t.wings} help={t.wingsHelp} />
      </div>
    </div>
  );
}

function SwatchGroup<T extends string>({
  label,
  values,
  current,
  colors,
  names,
  onPick,
}: {
  label: string;
  values: readonly T[];
  current: T;
  colors: Record<T, string>;
  names: Record<T, string>;
  onPick: (v: T) => void;
}) {
  return (
    <div className={s.group}>
      <span className={s.groupLabel}>
        {label} <span style={{ color: 'var(--c-muted)', fontWeight: 400 }}>· {names[current]}</span>
      </span>
      <div className={s.swatches} role="group" aria-label={label}>
        {values.map((v) => (
          <button
            key={v}
            type="button"
            className={s.swatch}
            style={{ background: colors[v] }}
            aria-pressed={current === v}
            aria-label={names[v]}
            title={names[v]}
            onClick={() => onPick(v)}
          />
        ))}
      </div>
    </div>
  );
}
