'use client';

import type { OverviewTodayDto, WorkLogFeedDto } from '@enu/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import { useOfficeOpen } from '@/realtime/useRealtime';

export interface OverviewState {
  /** Today first, then the earlier days loaded so far (newest first). Empty before the first load. */
  days: WorkLogFeedDto[];
  today: OverviewTodayDto | null;
  error: boolean;
  loadingOlder: boolean;
  loadOlder(): void;
  retry(): void;
}

const feedUrl = (day?: string) => `/api/v1/overview/feed${day ? `?day=${encodeURIComponent(day)}` : ''}`;

/**
 * The work overview (ADR 0007), loaded once for the panel and the popup. It loads while `active` and again on
 * `overview:refetch` (office hours only), when the office opens and when the tab becomes visible; a newer load
 * cancels an older one. Earlier days stay as loaded and are refreshed with today.
 */
export function useOverview(session: RealtimeSession, active: boolean): OverviewState {
  const [days, setDays] = useState<WorkLogFeedDto[]>([]);
  const [today, setToday] = useState<OverviewTodayDto | null>(null);
  const [error, setError] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [tick, setTick] = useState(0);
  const officeOpen = useOfficeOpen(session);
  const daysRef = useRef(days);
  useEffect(() => {
    daysRef.current = days;
  });

  const bump = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => session.on('overview:refetch', bump), [session, bump]);
  useEffect(() => {
    if (officeOpen) bump();
  }, [officeOpen, bump]);
  useEffect(() => {
    const on = () => {
      if (document.visibilityState === 'visible') bump();
    };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [bump]);

  useEffect(() => {
    if (!active) return;
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    const earlier = daysRef.current.slice(1).map((d) => d.day);
    Promise.all([
      apiFetch<WorkLogFeedDto>(feedUrl(), { signal }),
      apiFetch<OverviewTodayDto>('/api/v1/overview/today', { signal }),
      ...earlier.map((day) => apiFetch<WorkLogFeedDto>(feedUrl(day), { signal })),
    ])
      .then(([feed, status, ...rest]) => {
        const fresh = [feed as WorkLogFeedDto, ...(rest as WorkLogFeedDto[])];
        const byDay = new Map(fresh.map((d) => [d.day, d]));
        setDays((prev) =>
          // A new office day starts again from today alone.
          prev.length === 0 || prev[0]?.day !== fresh[0]?.day
            ? fresh.slice(0, 1)
            : prev.map((d) => byDay.get(d.day) ?? d),
        );
        setToday(status as OverviewTodayDto);
        setError(false);
      })
      .catch(() => {
        if (!signal.aborted) setError(true);
      });
    return () => ctrl.abort();
  }, [active, tick]);

  const loadOlder = useCallback(() => {
    const prevDay = daysRef.current.at(-1)?.prevDay;
    if (!prevDay) return;
    setLoadingOlder(true);
    apiFetch<WorkLogFeedDto>(feedUrl(prevDay))
      .then((feed) => setDays((prev) => (prev.some((d) => d.day === feed.day) ? prev : [...prev, feed])))
      .catch(() => setError(true))
      .finally(() => setLoadingOlder(false));
  }, []);

  return { days, today, error, loadingOlder, loadOlder, retry: bump };
}
