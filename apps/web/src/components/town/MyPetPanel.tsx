'use client';

import {
  PET_SPECIES_LABEL_KO,
  type MyPetDto,
  type NudgeDto,
  type PetSpecies,
  type TodoDto,
} from '@enu/shared';
import Link from 'next/link';
import { useState } from 'react';
import { CopyButton } from '@/components/CopyButton';
import { LinkGuide } from '@/components/LinkGuide';
import { PetSprite } from '@/components/sprites';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { api, sendJson } from './api';
import { Sheet } from './Chrome';
import { formatAbsolute, formatRelative } from './format';
import { useFetch, useNow } from './hooks';
import { LinkBadge } from './ProfileCard';
import { useTown } from './TownContext';
import s from './town.module.css';
import { useFxLayer, useQuestCelebration } from '@/components/fx/FxSprite';

const OPEN_NUDGE = new Set(['pending', 'shown', 'snoozed']);

export function snoozeUntilIso(minutes: number, from: Date = new Date()): string {
  return new Date(from.getTime() + minutes * 60_000).toISOString();
}

/** 내 펫: link state + how to connect, Claude's current nudges (verbatim) and to-dos with actions. */
export function MyPetPanel() {
  const { ui, me } = useTown();
  const now = useNow();
  const { data, loading, error, reload } = useFetch<MyPetDto>(api.myPet());
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const fx = useFxLayer();
  const { attach: questBox, celebrate } = useQuestCelebration(fx.play);
  const t = ko.townUi.pet;

  const act = async (key: string, fn: () => Promise<unknown>): Promise<boolean> => {
    setBusy(key);
    setFailed(false);
    try {
      await fn();
      reload();
      return true;
    } catch {
      setFailed(true);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const nudgeAction = (n: NudgeDto, action: 'ack' | 'dismiss' | 'snooze', minutes?: number) =>
    act(`n:${n.id}:${action}`, () =>
      sendJson('POST', api.nudgeAction(n.id), minutes ? { action, snooze_minutes: minutes } : { action }),
    );
  const todoPatch = (todo: TodoDto, key: string, body: Record<string, unknown>) =>
    act(`t:${todo.id}:${key}`, () => sendJson('PATCH', api.myTodo(todo.id), body));
  /** 퀘스트 완료: the seal and the jingle on my screen only, then the usual refresh. */
  const finishQuest = async (todo: TodoDto, el: HTMLElement) => {
    if (await todoPatch(todo, 'done', { status: 'done' })) celebrate(el);
  };

  const link = data?.linkState ?? me.linkState;
  const species = (data?.pet.species ?? me.pet.species) as PetSpecies;
  const nudges = (data?.nudges ?? []).filter((n) => OPEN_NUDGE.has(n.status));
  const todos = (data?.todos ?? []).filter((td) => td.status === 'open' || td.status === 'snoozed');

  return (
    <Sheet title={t.title} onClose={ui.closeSheet}>
      <div className={s.petHead}>
        <PetSprite species={species} scale={3} animate label={data?.pet.name ?? me.pet.name} />
        <div>
          <p className={s.petName}>{data?.pet.name ?? me.pet.name}</p>
          <div className={s.popoverSub}>{PET_SPECIES_LABEL_KO[species] ?? species}</div>
        </div>
      </div>

      <div className={s.card}>
        <div className={s.logHead}>
          <strong>{t.linkTitle}</strong>
          <LinkBadge state={link} />
        </div>
        <p className={s.explain}>{ko.linkStateHelp[link]}</p>
        <div className={s.cardMeta}>
          {t.lastLog}:{' '}
          {(data?.lastWorkLogAt ?? me.lastWorkLogAt)
            ? `${formatRelative(data?.lastWorkLogAt ?? me.lastWorkLogAt, now)} · ${formatAbsolute(data?.lastWorkLogAt ?? me.lastWorkLogAt, now)}`
            : ko.common.never}
        </div>
      </div>

      {link !== 'linked' && (
        <div className={s.section}>
          <h3 className={s.sectionTitle}>{ko.linkGuide.title}</h3>
          <LinkGuide mcpUrl={data?.mcpUrl ?? me.mcpUrl} compact />
        </div>
      )}

      <div className={s.section}>
        <h3 className={s.sectionTitle}>{t.checkinTitle}</h3>
        <div className={s.promptBox}>
          <code>{t.checkinPrompt}</code>
          <CopyButton text={t.checkinPrompt} />
        </div>
        <p className={s.explain}>{t.checkinHelp}</p>
      </div>

      <div className={s.section}>
        <h3 className={s.sectionTitle}>{t.nudges}</h3>
        <p className={s.explain}>{t.nudgesHelp}</p>
        {loading && !data && <div className={s.empty}>{ko.common.loading}</div>}
        {error && <div className={s.empty}>{ko.townUi.loadFailed}</div>}
        {data && nudges.length === 0 && <div className={s.empty}>{t.nudgesEmpty}</div>}
        {nudges.map((n) => (
          <div key={n.id} className={s.card}>
            <p className={s.nudgeText}>{n.text}</p>
            <div className={s.cardActions}>
              <Button size="sm" disabled={busy !== null} onClick={() => nudgeAction(n, 'ack')}>
                {ko.townUi.bubble.ack}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => nudgeAction(n, 'snooze', 30)}
              >
                {t.later30}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => nudgeAction(n, 'dismiss')}
              >
                {t.dismiss}
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className={s.section} style={{ position: 'relative' }} ref={questBox}>
        {fx.layer}
        <h3 className={s.sectionTitle}>{t.todos}</h3>
        {data && todos.length === 0 && <div className={s.empty}>{t.todosEmpty}</div>}
        {todos.map((td) => (
          <div key={td.id} className={s.card}>
            <div className={s.task}>
              <span className={s.prewrap}>{td.title}</span>
            </div>
            {td.note && <p className={s.explain}>{td.note}</p>}
            <div className={s.cardMeta}>
              {td.dueAt ? t.due(formatAbsolute(td.dueAt, now)) : td.dueDate ? t.due(td.dueDate) : ''}
              {td.status === 'snoozed' && td.snoozedUntil
                ? ` · ${t.snoozedUntil(formatAbsolute(td.snoozedUntil, now))}`
                : ''}
            </div>
            <div className={s.cardActions} style={{ marginTop: 6 }}>
              <Button
                size="sm"
                disabled={busy !== null}
                onClick={(e) => void finishQuest(td, e.currentTarget)}
              >
                {t.done}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => todoPatch(td, 'later30', { snoozed_until: snoozeUntilIso(30) })}
              >
                {t.later30}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => todoPatch(td, 'later60', { snoozed_until: snoozeUntilIso(60) })}
              >
                {t.later60}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => todoPatch(td, 'dismiss', { status: 'dismissed' })}
              >
                {t.dismiss}
              </Button>
            </div>
          </div>
        ))}
        {failed && <p className={s.err}>{t.actionFailed}</p>}
      </div>

      <p className={s.explain}>
        <Link href="/me">{t.openMe}</Link>
      </p>
    </Sheet>
  );
}
