'use client';

import { LIMITS, PET_SPECIES, type AvatarPreset, type MeDto, type PetSpecies } from '@enu/shared';
import { useState } from 'react';
import { AvatarEditor, type AvatarSwatches } from '@/components/AvatarEditor';
import { PetPicker } from '@/components/PetPicker';
import { Button, Card, Field, Notice, inputClass } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
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
  const [pet, setPet] = useState<{ species: PetSpecies; name: string }>({
    species: (PET_SPECIES as readonly string[]).includes(me.pet.species)
      ? (me.pet.species as PetSpecies)
      : 'cat',
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
      setMessage({ tone: 'success', text: ko.common.saved });
    } catch (e) {
      setMessage({ tone: 'error', text: describeError(e) });
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
          <Field label={t.statusText} htmlFor="status-text">
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
        <PetPicker species={pet.species} name={pet.name} onChange={setPet} />
      </Card>

      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className={s.saveBar}>
        <Button onClick={save} disabled={busy || !displayName.trim() || !pet.name.trim()}>
          {busy ? ko.common.saving : ko.common.save}
        </Button>
      </div>
    </>
  );
}
