'use client';

import { useEffect, useRef } from 'react';
import { useEscape, useFocusReturn } from '@/components/town/hooks';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import { useDen } from '../DenProvider';
import { OverviewFeed } from './OverviewFeed';
import { TownCanvas } from './TownCanvas';
import type { OverviewState } from './useOverview';
import { BlockersWidget, LiveTownWidget, TeamTodayWidget, TeamTotalsWidget } from './Widgets';
import o from './overview.module.css';

/**
 * The overview popup: a modal `<dialog>` over the whole messenger, whose page shows faintly through a blurred,
 * translucent backdrop. The town (the one Phaser game of the tab while open) and the feed on the left, the four
 * widgets on the right (everything stacks below 1024 px). Esc or 닫기 closes it and focus returns to the button that opened it.
 */
export function OverviewDialog({ overview, onClose }: { overview: OverviewState; onClose: () => void }) {
  const { me, session } = useDen();
  const ref = useRef<HTMLDialogElement | null>(null);
  const t = ko.den.overview;
  useFocusReturn();
  useEscape(onClose);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      if (d?.open) d.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={o.dialog}
      aria-labelledby="overview-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className={o.dialogHead}>
        <div>
          <h2 id="overview-title" className={o.dialogTitle}>
            {t.title}
          </h2>
          <p className={o.lead}>{t.lead}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={onClose}>
          {t.close}
        </Button>
      </header>
      <div className={o.grid}>
        <div className={o.gridTown} aria-label={ko.den.town.label} role="region">
          <TownCanvas />
        </div>
        <div className={o.gridFeed}>
          <OverviewFeed state={overview} variant="full" />
        </div>
        <div className={o.gridWidgets}>
          {/* The short widgets first: the long list of people goes last. */}
          <LiveTownWidget session={session} timeZone={me.officeTimeZone} />
          <TeamTotalsWidget today={overview.today} />
          <BlockersWidget today={overview.today} />
          <TeamTodayWidget today={overview.today} />
        </div>
      </div>
    </dialog>
  );
}
