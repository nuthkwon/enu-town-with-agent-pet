'use client';

import { LIMITS, PET_SPECIES, PET_SPECIES_LABEL_KO, type PetSpecies } from '@enu/shared';
import { ko } from '@/i18n/ko';
import { isTaken } from './petChoice';
import { Field, inputClass } from './ui';
import { PetSprite } from './sprites';
import s from './editors.module.css';

/**
 * Pet species + name. Every member has a different pet: species colleagues already have
 * (MeDto.takenPetSpecies) are greyed out with a hint and cannot be picked.
 */
export function PetPicker({
  species,
  name,
  taken = [],
  onChange,
}: {
  species: PetSpecies;
  name: string;
  taken?: readonly string[];
  onChange: (next: { species: PetSpecies; name: string }) => void;
}) {
  const t = ko.welcome.pet;
  return (
    <div>
      {taken.length > 0 && <p className={s.petHint}>{t.takenHint}</p>}
      <div className={s.petGrid} role="group" aria-label={t.title}>
        {PET_SPECIES.map((sp) => {
          const takenByOther = isTaken(sp, taken);
          // A taken species can never be picked; if it is still selected (a 409 just said so) it shows the tag.
          const blocked = takenByOther && sp !== species;
          const label = takenByOther ? `${PET_SPECIES_LABEL_KO[sp]} (${t.taken})` : PET_SPECIES_LABEL_KO[sp];
          return (
            <button
              key={sp}
              type="button"
              className={blocked ? `${s.petOption} ${s.petTaken}` : s.petOption}
              aria-pressed={species === sp}
              disabled={blocked}
              title={label}
              onClick={() => onChange({ species: sp, name })}
            >
              <PetSprite species={sp} scale={3} animate={species === sp} label={label} />
              <span>{PET_SPECIES_LABEL_KO[sp]}</span>
              {takenByOther && <span className={s.petTakenTag}>{t.taken}</span>}
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 18, maxWidth: 320 }}>
        <Field label={t.name} htmlFor="pet-name">
          <input
            id="pet-name"
            className={inputClass}
            value={name}
            maxLength={LIMITS.petNameMax}
            placeholder={t.namePlaceholder}
            onChange={(e) => onChange({ species, name: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
