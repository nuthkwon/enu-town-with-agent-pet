'use client';

import { LIMITS, type AvatarPreset, type MeDto, type PetSpecies } from '@enu/shared';
import { useState } from 'react';
import { AvatarEditor, type AvatarSwatches } from '@/components/AvatarEditor';
import { asSpecies, isTaken } from '@/components/petChoice';
import { PetPicker } from '@/components/PetPicker';
import { Button, Card, Field, Notice, inputClass } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { ApiRequestError, apiFetch, describeError } from '@/lib/api';
import s from './me.module.css';

const t = ko.me.profile;

export function ProfileTab({
  me,
  swatches,
  onSaved,
}: {
  me: MeDto;
  swatches: AvatarSwatches;
  onSaved: (me: MeDto) => void;
}) {
  const [displayName, setDisplayName] = useState(me.displayName);
  const [statusText, setStatusText] = useState(me.statusText ?? '');
  const [avatar, setAvatar] = useState<AvatarPreset>(me.avatar);
  // My current pet stays selectable; species colleagues already have are greyed out.
  const [taken, setTaken] = useState<readonly string[]>(me.takenPetSpecies);
  const [pet, setPet] = useState<{ species: PetSpecies; name: string }>({
    species: asSpecies(me.pet.species),
    name: me.pet.name,
  });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const next = await apiFetch<MeDto>('/api/v1/me/profile', {
        method: 'PATCH',
        body: {
          display_name: displayName.trim(),
          status_text: statusText.trim() ? statusText.trim() : null,
          avatar,
          pet_species: pet.species,
          pet_name: pet.name.trim(),
        },
      });
      onSaved(next);
      setTaken(next.takenPetSpecies);
      setMessage({ tone: 'success', text: ko.common.saved });
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'pet_taken') {
        setTaken((t) => (t.includes(pet.species) ? t : [...t, pet.species]));
        setMessage({ tone: 'error', text: ko.errors.petTaken });
      } else {
        setMessage({ tone: 'error', text: describeError(e) });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card title={ko.me.tabs.profile}>
        <div className={s.formGrid}>
          <Field label={t.displayName} htmlFor="display-name">
            <input
              id="display-name"
              className={inputClass}
              value={displayName}
              maxLength={LIMITS.displayNameMax}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </Field>
          <Field label={t.statusText} htmlFor="status-text" help={t.statusTextHelp}>
            <input
              id="status-text"
              className={inputClass}
              value={statusText}
              maxLength={LIMITS.statusTextMax}
              placeholder={t.statusPlaceholder}
              onChange={(e) => setStatusText(e.target.value)}
            />
          </Field>
          <Field label={t.team} htmlFor="team" help={t.readOnly}>
            <input id="team" className={inputClass} value={me.teamLabel || '-'} readOnly />
          </Field>
          <Field label={t.title} htmlFor="title">
            <input id="title" className={inputClass} value={me.title ?? '-'} readOnly />
          </Field>
        </div>
        {me.roleNote && (
          <Field label={t.role} htmlFor="role">
            <input id="role" className={inputClass} value={me.roleNote} readOnly />
          </Field>
        )}
      </Card>

      <Card title={t.avatarTitle}>
        <AvatarEditor value={avatar} onChange={setAvatar} swatches={swatches} />
      </Card>

      <Card title={t.petTitle}>
        <PetPicker species={pet.species} name={pet.name} taken={taken} onChange={setPet} />
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className={s.saveBar}>
        <Button
          onClick={save}
          disabled={
            busy ||
            !displayName.trim() ||
            !pet.name.trim() ||
            (isTaken(pet.species, taken) && pet.species !== me.pet.species)
          }
        >
          {busy ? ko.common.saving : ko.common.save}
        </Button>
      </div>
    </>
  );
}
