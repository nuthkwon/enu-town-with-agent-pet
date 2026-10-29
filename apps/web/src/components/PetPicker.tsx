'use client';

import { LIMITS, PET_SPECIES, PET_SPECIES_LABEL_KO, type PetSpecies } from '@enu/shared';
import { ko } from '@/i18n/ko';
import { Field, inputClass } from './ui';
import { PetSprite } from './sprites';
import s from './editors.module.css';

export function PetPicker({
  species,
  name,
  onChange,
}: {
  species: PetSpecies;
  name: string;
  onChange: (next: { species: PetSpecies; name: string }) => void;
}) {
  return (
    <div>
      <div className={s.petGrid} role="group" aria-label={ko.welcome.pet.title}>
        {PET_SPECIES.map((sp) => (
          <button
            key={sp}
            type="button"
            className={s.petOption}
            aria-pressed={species === sp}
            onClick={() => onChange({ species: sp, name })}
          >
            <PetSprite species={sp} scale={3} animate={species === sp} label={PET_SPECIES_LABEL_KO[sp]} />
            <span>{PET_SPECIES_LABEL_KO[sp]}</span>
          </button>
        ))}
      </div>
      <div style={{ marginTop: 18, maxWidth: 320 }}>
        <Field label={ko.welcome.pet.name} htmlFor="pet-name">
          <input
            id="pet-name"
            className={inputClass}
            value={name}
            maxLength={LIMITS.petNameMax}
            placeholder={ko.welcome.pet.namePlaceholder}
            onChange={(e) => onChange({ species, name: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
