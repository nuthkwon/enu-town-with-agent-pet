'use client';

import {
  APP_TIMEZONE_DEFAULT,
  localDateKey,
  type ColleaguePetMessageDto,
  type PetInfoDto,
  type PetThreadPageDto,
  type WorkLogDto,
} from '@enu/shared';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch } from '@/lib/api';
import { buildTimeline, prependPage } from '../model/timeline';
import { CompanionSprite } from './CompanionSprite';
import { Timeline } from './Timeline';
import s from '../den.module.css';

/**
 * Someone else's pet room: company messages only, dates only, read over REST (no push, no live region, no
 * companion mood: a still pet). The owner gets the same view of their own room as a preview.
 */
export function ColleaguePetRoom({
  ownerId,
  ownerName,
  pet,
}: {
  ownerId: string;
  ownerName: string;
  pet: PetInfoDto;
}) {
  const [items, setItems] = useState<ColleaguePetMessageDto[]>([]);
  const [logs, setLogs] = useState<WorkLogDto[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const t = ko.den.colleague;
  const base = `/api/v1/users/${encodeURIComponent(ownerId)}/pets/${pet.id}/thread`;

  useEffect(() => {
    const ctrl = new AbortController();
    setItems([]);
    setLogs([]);
    setLoaded(false);
    apiFetch<PetThreadPageDto<ColleaguePetMessageDto>>(base, { signal: ctrl.signal })
      .then((page) => {
        setItems(page.items);
        setLogs(page.workLogs);
        setNextCursor(page.nextCursor);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
    return () => ctrl.abort();
  }, [base]);

  const loadOlder = async () => {
    if (!nextCursor) return;
    const page = await apiFetch<PetThreadPageDto<ColleaguePetMessageDto>>(
      `${base}?cursor=${encodeURIComponent(nextCursor)}`,
    );
    setItems((shown) => prependPage(shown, page.items));
    setLogs((shown) => [...page.workLogs.filter((l) => !shown.some((x) => x.id === l.id)), ...shown]);
    setNextCursor(page.nextCursor);
  };

  const entries = useMemo(() => buildTimeline(items, logs), [items, logs]);
  return (
    <>
      <header className={s.roomHead}>
        <span className={s.companionStage} style={{ width: 88, height: 88 }}>
          <CompanionSprite
            species={pet.species}
            tint={pet.tint}
            expression="idle"
            scale={3}
            label={pet.name}
          />
        </span>
        <div>
          <h1 className={s.roomTitle} tabIndex={-1}>
            {t.title(ownerName, pet.name)}
          </h1>
          <p className={s.roomSub}>
            <Link href={`/people/${ownerId}`}>{ownerName}</Link>
          </p>
        </div>
      </header>
      <p className={s.notice}>{t.dateOnly}</p>
      <div className={s.timeline}>
        {nextCursor && (
          <div className={s.older}>
            <Button size="sm" variant="secondary" onClick={() => void loadOlder()}>
              {ko.den.pet.older}
            </Button>
          </div>
        )}
        {loaded && entries.length === 0 && <div className={s.empty}>{t.empty}</div>}
        <Timeline
          entries={entries}
          todayKey={localDateKey(new Date(), APP_TIMEZONE_DEFAULT)}
          petName={pet.name}
          label={t.title(ownerName, pet.name)}
        />
      </div>
    </>
  );
}
