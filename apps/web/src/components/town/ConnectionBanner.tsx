'use client';

import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ConnectionStatus } from '@/realtime/types';
import s from './town.module.css';

/**
 * Actionable connection states (transient ones are shown in the canvas by the UI scene):
 * 4101 replaced -> 다시 연결, gave up -> 지금 다시 시도, map changed -> 새로고침, forbidden -> 로그인.
 */
export function ConnectionBanner({ status, session }: { status: ConnectionStatus; session: RealtimeSession }) {
  const t = ko.townUi.connection;
  let text: string | null = null;
  let action: { label: string; onClick: () => void } | null = null;
  switch (status.kind) {
    case 'replaced':
      text = t.replaced;
      action = { label: t.reconnect, onClick: () => session.reconnectNow() };
      break;
    case 'failed':
      text = t.failed;
      action = { label: t.retryNow, onClick: () => session.reconnectNow() };
      break;
    case 'map_mismatch':
      text = t.mapMismatch;
      action = { label: t.reload, onClick: () => window.location.reload() };
      break;
    case 'forbidden':
      text = t.forbidden;
      action = { label: t.signIn, onClick: () => window.location.assign('/sign-in') };
      break;
    default:
      return null;
  }
  return (
    <div className={s.banners}>
      <div className={s.banner} role="alert">
        <span className={s.bannerText}>{text}</span>
        {action && (
          <Button size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        )}
      </div>
    </div>
  );
}
