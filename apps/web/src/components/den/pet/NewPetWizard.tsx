'use client';

import { PET_SPECIES, type OwnerPetDto, type PetTint } from '@enu/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { useDen } from '../DenProvider';
import { PET_FORM_SECTIONS, PetFields, PetPreview, petFormBody, type PetFormValue } from './PetForm';
import s from '../den.module.css';

/** "새 펫 만들기": name, look, role, how it answers, visibility; then straight into its room. */
export function NewPetWizard() {
  const { pets, reloadPets } = useDen();
  const router = useRouter();
  const t = ko.den.newPet;
  const taken = useMemo(() => new Set((pets ?? []).map((p) => `${p.species}:${p.tint}`)), [pets]);
  const firstFree = (): { species: (typeof PET_SPECIES)[number]; tint: PetTint } => {
    for (const species of PET_SPECIES)
      for (const tint of ['mint', 'rose', 'sky', 'lemon', 'lilac'] as const)
        if (!taken.has(`${species}:${tint}`)) return { species, tint };
    return { species: 'cat', tint: 'mint' };
  };
  const [value, setValue] = useState<PetFormValue>(() => ({
    name: '',
    ...firstFree(),
    role_instructions: '',
    reply_route: 'both',
    default_visibility: null,
  }));
  // Opened directly, my pets may arrive after the first render: move off a look one of them already has.
  useEffect(() => {
    if (taken.has(`${value.species}:${value.tint}`)) setValue((v) => ({ ...v, ...firstFree() }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-check only when my pets change
  }, [taken]);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atLimit = (pets?.length ?? 0) >= 5;
  const last = step === PET_FORM_SECTIONS.length - 1;

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const pet = await apiFetch<OwnerPetDto>('/api/v1/me/pets', {
        method: 'POST',
        body: petFormBody(value),
      });
      // The room finds the pet in the shell's list: refresh it first (no "not found" flash).
      await reloadPets();
      router.push(`/pets/${pet.id}`);
    } catch (e) {
      setError(describeError(e));
      setBusy(false);
    }
  };

  return (
    <div className={s.page}>
      <div className={s.pageInner}>
        <header>
          <h1 className={s.roomTitle} tabIndex={-1}>
            {t.title}
          </h1>
          <p className={s.roomSub}>{t.lead}</p>
          <ol className={s.chips} aria-label={t.title}>
            {t.steps.map((label, i) => (
              <li
                key={label}
                aria-current={i === step ? 'step' : undefined}
                style={{ fontWeight: i === step ? 700 : 400 }}
              >
                {i + 1}. {label}
              </li>
            ))}
          </ol>
        </header>
        {atLimit ? (
          <p className={s.alert}>{t.limit}</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (last) void create();
              else setStep(step + 1);
            }}
          >
            <PetPreview value={value} />
            <PetFields
              value={value}
              onChange={setValue}
              isDefault={false}
              takenLooks={taken}
              sections={[PET_FORM_SECTIONS[step]!]}
            />
            {error && (
              <p className={s.alert} role="alert">
                {error}
              </p>
            )}
            <div className={s.chips} style={{ marginTop: 12 }}>
              {step > 0 && (
                <Button variant="secondary" onClick={() => setStep(step - 1)}>
                  {t.back}
                </Button>
              )}
              <Button type="submit" disabled={busy || (step === 0 && !value.name.trim())}>
                {last ? (busy ? t.creating : t.create) : t.next}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
