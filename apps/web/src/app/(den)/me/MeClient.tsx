'use client';

import type { ClaudeLinkDto, MeDto, Paginated, TodoDto, WorkLogDto } from '@enu/shared';
import { useState } from 'react';
import type { AvatarSwatches } from '@/components/AvatarEditor';
import { AvatarSprite, PetSprite, SpriteStage } from '@/components/sprites';
import { Badge, cx, ui } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { formatDateTime } from '@/lib/format';
import { ExportTab } from './ExportTab';
import { LinkTab, linkTone } from './LinkTab';
import { LogsTab } from './LogsTab';
import { ProfileTab } from './ProfileTab';
import { SettingsTab } from './SettingsTab';
import { TodosTab } from './TodosTab';
import s from './me.module.css';

export type MeTab = 'link' | 'logs' | 'todos' | 'settings' | 'profile' | 'export';
const TAB_ORDER: MeTab[] = ['link', 'logs', 'todos', 'settings', 'profile', 'export'];

export function MeClient({
  me: initialMe,
  links,
  logs,
  todos,
  swatches,
  initialTab,
  focusLogId,
}: {
  me: MeDto;
  links: ClaudeLinkDto[];
  logs: Paginated<WorkLogDto>;
  todos: TodoDto[];
  swatches: AvatarSwatches;
  initialTab: MeTab;
  focusLogId: string | null;
}) {
  const [me, setMe] = useState(initialMe);
  const [tab, setTab] = useState<MeTab>(initialTab);

  function select(next: MeTab) {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      url.searchParams.delete('log');
      window.history.replaceState(null, '', url.toString());
    } catch {
      // ignore
    }
  }

  return (
    <div className={s.scroll}>
      <div className={s.layout}>
        <aside className={s.side}>
          <div className={cx(ui.card, s.profileCard)}>
            <SpriteStage size={150}>
              <AvatarSprite preset={me.avatar} scale={4} animate label={me.displayName} />
            </SpriteStage>
            <div className={s.profileName}>{me.displayName}</div>
            <div className={s.profileMeta}>
              {[me.teamLabel, me.title].filter(Boolean).join(' · ') || me.email}
            </div>
            <div className={s.profileBadges}>
              <Badge tone={linkTone(me.linkState)} dot>
                {ko.linkState[me.linkState]}
              </Badge>
              {me.deskId && <Badge tone="sky">{me.deskId}</Badge>}
              {me.isAdmin && <Badge tone="pink">{ko.common.adminBadge}</Badge>}
            </div>
            <div className={s.petRow}>
              <PetSprite species={me.pet.species} scale={2} animate label={me.pet.name} />
              <span>{me.pet.name}</span>
            </div>
            <div className={s.lastLog}>
              {ko.me.link.lastLog}:{' '}
              {me.lastWorkLogAt ? formatDateTime(me.lastWorkLogAt, me.timezone) : ko.common.never}
            </div>
          </div>
        </aside>

        <div className={s.mainCol}>
          <h1 className={ui.sparkleTitle}>{ko.me.title}</h1>
          <div className={ui.tabs} role="tablist" aria-label={ko.me.title}>
            {TAB_ORDER.map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                id={`tab-${t}`}
                aria-selected={tab === t}
                aria-controls={`panel-${t}`}
                className={ui.tab}
                onClick={() => select(t)}
              >
                {ko.me.tabs[t]}
              </button>
            ))}
          </div>

          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className={s.panel}>
            {tab === 'link' && <LinkTab me={me} initialLinks={links} />}
            {tab === 'logs' && <LogsTab initial={logs} focusId={focusLogId} timezone={me.timezone} />}
            {tab === 'todos' && <TodosTab initial={todos} timezone={me.timezone} />}
            {tab === 'settings' && <SettingsTab me={me} onSaved={setMe} />}
            {tab === 'profile' && <ProfileTab me={me} swatches={swatches} onSaved={setMe} />}
            {tab === 'export' && <ExportTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
