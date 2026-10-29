'use client';

import {
  LIMITS,
  PET_SPECIES,
  PET_SPECIES_LABEL_KO,
  PET_TINTS,
  type OwnerPetDto,
  type PetReplyRoute,
  type PetSpecies,
  type PetTint,
  type Visibility,
} from '@enu/shared';
import { PetSprite } from '@/components/sprites';
import { Button, Field, inputClass, selectClass, textareaClass } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { CompanionSprite } from './CompanionSprite';
import s from '../den.module.css';

export interface PetFormValue {
  name: string;
  species: PetSpecies;
  tint: PetTint;
  role_instructions: string;
  reply_route: PetReplyRoute;
  default_visibility: Visibility | null;
}

export function petFormValue(p: OwnerPetDto): PetFormValue {
  return {
    name: p.name,
    species: p.species,
    tint: p.tint,
    role_instructions: p.roleInstructions ?? '',
    reply_route: p.replyRoute,
    default_visibility: p.defaultVisibility,
  };
}

/** Request body for POST /me/pets or PATCH /me/pets/:id (an empty role means none). */
export function petFormBody(v: PetFormValue): Record<string, unknown> {
  return {
    name: v.name,
    species: v.species,
    tint: v.tint,
    role_instructions: v.role_instructions.trim() ? v.role_instructions : null,
    reply_route: v.reply_route,
    default_visibility: v.default_visibility,
  };
}

type Section = 'name' | 'look' | 'role' | 'route' | 'visibility';
export const PET_FORM_SECTIONS: readonly Section[] = ['name', 'look', 'role', 'route', 'visibility'];

/**
 * The fields of a pet (ADR 0005). Looks other pets of mine already use are disabled; the base tint belongs to
 * the default pet. The preview shows only what I wrote: a pet never "speaks" here (no invented pet text).
 */
export function PetFields({
  value,
  onChange,
  isDefault,
  takenLooks,
  sections = PET_FORM_SECTIONS,
}: {
  value: PetFormValue;
  onChange: (v: PetFormValue) => void;
  isDefault: boolean;
  /** `species:tint` of my other pets. */
  takenLooks: ReadonlySet<string>;
  sections?: readonly Section[];
}) {
  const t = ko.den.newPet;
  const set = <K extends keyof PetFormValue>(k: K, v: PetFormValue[K]) => onChange({ ...value, [k]: v });
  const tints = isDefault ? (['base'] as const) : PET_TINTS.filter((x) => x !== 'base');
  const has = (x: Section) => sections.includes(x);
  return (
    <div className={s.pageInner}>
      {has('name') && (
        <Field label={t.name} help={t.nameHelp} htmlFor="pet-name">
          <input
            id="pet-name"
            className={inputClass}
            value={value.name}
            maxLength={LIMITS.petNameMax}
            onChange={(e) => set('name', e.target.value)}
            required
          />
        </Field>
      )}
      {has('look') && !isDefault && (
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className={s.navTitle}>{t.look}</legend>
          <p className={s.roomSub}>{t.lookHelp}</p>
          <div className={s.lookGrid}>
            {PET_SPECIES.map((sp) => (
              <button
                key={sp}
                type="button"
                className={s.lookOption}
                aria-pressed={value.species === sp}
                onClick={() => set('species', sp)}
              >
                <PetSprite species={sp} tint={value.tint} scale={2} label={PET_SPECIES_LABEL_KO[sp]} />
                {PET_SPECIES_LABEL_KO[sp]}
              </button>
            ))}
          </div>
          <div className={s.tintRow} style={{ marginTop: 8 }}>
            {tints.map((tint) => {
              const taken = takenLooks.has(`${value.species}:${tint}`);
              return (
                <button
                  key={tint}
                  type="button"
                  className={s.lookOption}
                  aria-pressed={value.tint === tint}
                  disabled={taken}
                  title={taken ? t.lookTaken : undefined}
                  onClick={() => set('tint', tint)}
                >
                  <PetSprite species={value.species} tint={tint} scale={1.5} label={t.tint[tint]} />
                  {t.tint[tint]}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {has('role') && (
        <Field label={t.role} help={t.roleHelp} htmlFor="pet-role">
          <textarea
            id="pet-role"
            className={textareaClass}
            value={value.role_instructions}
            maxLength={LIMITS.petRoleInstructionsMax}
            rows={3}
            onChange={(e) => set('role_instructions', e.target.value)}
          />
          <div className={s.chips}>
            {t.roleExamples.map((ex) => (
              <Button key={ex} size="sm" variant="ghost" onClick={() => set('role_instructions', ex)}>
                {ex}
              </Button>
            ))}
          </div>
        </Field>
      )}
      {has('route') && (
        <Field label={t.route} htmlFor="pet-route">
          <select
            id="pet-route"
            className={selectClass}
            value={value.reply_route}
            onChange={(e) => set('reply_route', e.target.value as PetReplyRoute)}
          >
            {(['both', 'channel', 'checkin'] as const).map((r) => (
              <option key={r} value={r}>
                {t.routeOptions[r]}
              </option>
            ))}
          </select>
        </Field>
      )}
      {has('visibility') && (
        <Field label={t.visibility} htmlFor="pet-visibility">
          <select
            id="pet-visibility"
            className={selectClass}
            value={value.default_visibility ?? 'inherit'}
            onChange={(e) =>
              set('default_visibility', e.target.value === 'inherit' ? null : (e.target.value as Visibility))
            }
          >
            <option value="inherit">{t.visibilityOptions.inherit}</option>
            <option value="company">{t.visibilityOptions.company}</option>
            <option value="private">{t.visibilityOptions.private}</option>
          </select>
        </Field>
      )}
    </div>
  );
}

/** A still preview of the pet: its look, name and my own role note (labelled as mine). */
export function PetPreview({ value }: { value: PetFormValue }) {
  const t = ko.den.newPet;
  return (
    <div className={s.preview} aria-label={t.preview}>
      <span className={s.companionStage} style={{ width: 96, height: 96 }}>
        <CompanionSprite
          species={value.species}
          tint={value.tint}
          expression="happy"
          scale={3}
          label={value.name || t.preview}
        />
      </span>
      <div>
        <strong>{value.name || '…'}</strong>
        <div className={s.chips}>
          <span className={s.roomSub}>{t.routeOptions[value.reply_route]}</span>
        </div>
        {value.role_instructions.trim() && (
          <>
            <div className={s.meta}>{t.previewRole}</div>
            <p className={s.roleNote}>{value.role_instructions}</p>
          </>
        )}
      </div>
    </div>
  );
}
