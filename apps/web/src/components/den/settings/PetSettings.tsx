'use client';

import { PET_CHANNEL, type OwnerPetDto, type PetChannelPairingCodeDto } from '@enu/shared';
import { useMemo, useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { PetSprite } from '@/components/sprites';
import { Badge, Button, Card } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch, describeError } from '@/lib/api';
import { useDen } from '../DenProvider';
import { PetFields, petFormBody, petFormValue, type PetFormValue } from '../pet/PetForm';
import s from '../den.module.css';

function PetEditor({
  pet,
  taken,
  onDone,
}: {
  pet: OwnerPetDto;
  taken: ReadonlySet<string>;
  onDone: () => void;
}) {
  const [value, setValue] = useState<PetFormValue>(() => petFormValue(pet));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = petFormBody(value);
      if (pet.isDefault) {
        delete body.species;
        delete body.tint;
      }
      await apiFetch(`/api/v1/me/pets/${pet.id}`, { method: 'PATCH', body });
      onDone();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <PetFields value={value} onChange={setValue} isDefault={pet.isDefault} takenLooks={taken} />
      {error && (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
      <div className={s.chips}>
        <Button type="submit" disabled={busy}>
          {ko.common.save}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {ko.common.cancel}
        </Button>
      </div>
    </form>
  );
}

/** /settings/pets: my pets (order, edit, delete) and the optional Claude Code pet channel. */
export function PetSettings() {
  const { pets, reloadPets, channel, reloadChannel } = useDen();
  const [editing, setEditing] = useState<string | null>(null);
  const [code, setCode] = useState<PetChannelPairingCodeDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = ko.den.settings;
  const list = pets ?? [];

  const takenFor = (id: string) =>
    new Set(list.filter((p) => p.id !== id).map((p) => `${p.species}:${p.tint}`));
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      reloadPets();
    } catch (e) {
      setError(describeError(e));
    }
  };
  const move = (i: number, by: -1 | 1) => {
    const a = list[i];
    const b = list[i + by];
    if (!a || !b || a.isDefault || b.isDefault) return;
    void run(async () => {
      await apiFetch(`/api/v1/me/pets/${a.id}`, { method: 'PATCH', body: { sort_order: b.sortOrder } });
      await apiFetch(`/api/v1/me/pets/${b.id}`, { method: 'PATCH', body: { sort_order: a.sortOrder } });
    });
  };
  const remove = (p: OwnerPetDto) => {
    if (!window.confirm(t.removeConfirm(p.name))) return;
    void run(() => apiFetch(`/api/v1/me/pets/${p.id}`, { method: 'DELETE' }));
  };
  const makeCode = () =>
    void run(async () =>
      setCode(
        await apiFetch<PetChannelPairingCodeDto>('/api/v1/me/pet-channel/pairing-codes', { method: 'POST' }),
      ),
    );
  const unpair = (linkId: string) =>
    void run(async () => {
      await apiFetch('/api/v1/me/claude-links/revoke', { method: 'POST', body: { link_id: linkId } });
      reloadChannel();
    });

  const machines = useMemo(() => channel?.machines ?? [], [channel]);
  return (
    <div className={s.page}>
      <div className={s.pageInner}>
        <h1 className={s.roomTitle} tabIndex={-1}>
          {t.petsTitle}
        </h1>
        <p className={s.roomSub}>{t.petsLead}</p>
        {error && (
          <p className={s.alert} role="alert">
            {error}
          </p>
        )}
        <Card>
          {list.map((p, i) => (
            <div key={p.id}>
              <div className={s.petRow}>
                <PetSprite species={p.species} tint={p.tint} scale={2} label={p.name} />
                <div className={s.petRowText}>
                  <strong>{p.name}</strong> {p.isDefault && <Badge>{ko.den.pet.defaultBadge}</Badge>}
                  <div className={s.navLast}>{ko.den.pet.route[p.replyRoute]}</div>
                </div>
                {!p.isDefault && (
                  <>
                    <Button size="sm" variant="ghost" disabled={i <= 1} onClick={() => move(i, -1)}>
                      {t.up}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={i === list.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      {t.down}
                    </Button>
                  </>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(editing === p.id ? null : p.id)}
                >
                  {t.edit}
                </Button>
                {!p.isDefault && (
                  <Button size="sm" variant="danger" onClick={() => remove(p)}>
                    {t.remove}
                  </Button>
                )}
              </div>
              {editing === p.id && (
                <PetEditor
                  pet={p}
                  taken={takenFor(p.id)}
                  onDone={() => {
                    setEditing(null);
                    reloadPets();
                  }}
                />
              )}
            </div>
          ))}
        </Card>

        <Card title={t.channelTitle} subtitle={t.channelLead}>
          <Button onClick={makeCode}>{t.makeCode}</Button>
          {code && (
            <div style={{ marginTop: 12 }}>
              <p className={s.roomSub}>{t.codeHelp(PET_CHANNEL.pairCodeTtlMin)}</p>
              <div className={s.codeBox}>
                <code>{code.command}</code>
                <CopyButton text={code.command} />
              </div>
            </div>
          )}
          <h3 className={s.navTitle} style={{ marginTop: 16 }}>
            {t.machines}
          </h3>
          {machines.length === 0 && <p className={s.roomSub}>{t.noMachines}</p>}
          {machines.map((m) => (
            <div key={m.linkId} className={s.petRow}>
              <div className={s.petRowText}>
                <strong>{m.label}</strong> {channel?.live && <Badge tone="mint">{t.live}</Badge>}
                <div className={s.navLast}>{t.until(m.expiresAt.slice(0, 10))}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => unpair(m.linkId)}>
                {t.unpair}
              </Button>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
