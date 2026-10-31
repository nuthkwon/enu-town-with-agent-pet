'use client';

import type { PetInfoDto, PersonDto } from '@enu/shared';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AvatarSprite, PetSprite } from '@/components/sprites';
import { buttonClass } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { apiFetch } from '@/lib/api';
import { useDen } from '../DenProvider';
import s from '../den.module.css';
import { MagicButton } from '../MagicButton';

/** A colleague: who they are, their pets (each a read-only room) and a way to write to them. */
export function PersonPage({ person }: { person: PersonDto }) {
  const { me } = useDen();
  const [pets, setPets] = useState<PetInfoDto[] | null>(null);
  const t = ko.den.colleague;

  useEffect(() => {
    const ctrl = new AbortController();
    apiFetch<PetInfoDto[]>(`/api/v1/users/${encodeURIComponent(person.userId)}/pets`, { signal: ctrl.signal })
      .then(setPets)
      .catch(() => setPets([]));
    return () => ctrl.abort();
  }, [person.userId]);

  return (
    <div className={s.page}>
      <div className={s.pageInner}>
        <header className={s.preview}>
          <AvatarSprite preset={person.avatar} scale={3} label={person.displayName} />
          <div>
            <h1 className={s.roomTitle} tabIndex={-1}>
              {person.displayName}
            </h1>
            <p className={s.roomSub}>
              {[person.teamLabel, person.title, person.roleNote].filter(Boolean).join(' · ')}
            </p>
          </div>
          {person.userId !== me.userId && (
            <div className={s.headActions}>
              <Link className={buttonClass('primary', 'sm')} href={`/dm/${person.userId}`}>
                {t.dm}
              </Link>
              <MagicButton peerId={person.userId} />
            </div>
          )}
        </header>
        <section>
          <h2 className={s.navTitle}>{t.pets}</h2>
          <ul className={s.navList}>
            {(pets ?? []).map((p) => (
              <li key={p.id}>
                <Link className={s.navItem} href={`/people/${person.userId}/pets/${p.id}`}>
                  <PetSprite species={p.species} tint={p.tint} scale={2} label={p.name} />
                  <span className={s.navName}>{p.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
