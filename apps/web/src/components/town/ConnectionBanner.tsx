'use client';

import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import type { RealtimeSession } from '@/realtime/RealtimeSession';
import type { ConnectionStatus } from '@/realtime/types';
import s from './town.module.css';

/**
 * Actionable connection states (transient ones are shown in the canvas by the UI scene):
 * 4101 replaced -> 다시 연결, gave up -> 지금 다시 시도, map or protocol changed -> 새로고침,
 * forbidden -> 로그인, privacy notice not accepted -> 안내 보기 (/welcome).
 */
export function ConnectionBanner({ status, session }: { status: ConnectionStatus; session: RealtimeSession }) {
  const router = useRouter();
  const t = ko.townUi.connection;
  const view = ((): { text: string; label: string; onClick: () => void } | null => {
    switch (status.kind) {
      case 'replaced':
        return { text: t.replaced, label: t.reconnect, onClick: () => session.reconnectNow() };
      case 'failed':
        return { text: t.failed, label: t.retryNow, onClick: () => session.reconnectNow() };
      case 'map_mismatch':
        return { text: t.mapMismatch, label: t.reload, onClick: () => window.location.reload() };
      case 'protocol_mismatch':
        return { text: ko.townUi.protocolMismatch, label: t.reload, onClick: () => window.location.reload() };
      case 'notice_required':
        return { text: t.noticeRequired, label: t.openWelcome, onClick: () => router.push('/welcome') };
      case 'forbidden':
        return { text: t.forbidden, label: t.signIn, onClick: () => router.push('/sign-in') };
      default:
        return null;
    }
  })();
  if (!view) return null;
  return (
    <div className={s.banner} role="alert">
      <span className={s.bannerText}>{view.text}</span>
      <Button size="sm" onClick={view.onClick}>
        {view.label}
      </Button>
    </div>
  );
}
