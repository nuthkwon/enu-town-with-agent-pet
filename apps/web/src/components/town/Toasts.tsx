'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { ko } from '@/i18n/ko';
import type { ToastInput } from './TownContext';
import s from './town.module.css';

export interface ToastItem extends ToastInput {
  id: number;
}

function ToastView({ toast, onClose }: { toast: ToastItem; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const ttl = toast.ttlMs ?? 7000;
    if (ttl <= 0) return;
    const id = setTimeout(() => closeRef.current(), ttl);
    return () => clearTimeout(id);
  }, [toast.ttlMs]);
  return (
    <div className={s.toast} role="status">
      <div className={s.toastRow}>
        <span className={s.toastText}>{toast.text}</span>
        <button type="button" className={s.closeX} onClick={onClose} aria-label={ko.townUi.toast.close}>
          ✕
        </button>
      </div>
      {toast.actions && toast.actions.length > 0 && (
        <div className={s.toastActions}>
          {toast.actions.map((a, i) => (
            <Button
              key={a.label}
              size="sm"
              variant={i === 0 ? 'primary' : 'secondary'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await a.onClick();
                } finally {
                  setBusy(false);
                  onClose();
                }
              }}
            >
              {a.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Notices (work log published, pings, waves, DMs) stacked top-right (left of the docked team rail). */
export function Toasts({
  toasts,
  onClose,
  docked = false,
  className = '',
}: {
  toasts: ToastItem[];
  onClose: (id: number) => void;
  docked?: boolean;
  /** Placement override (the messenger shows them at the top centre of the page). */
  className?: string;
}) {
  if (toasts.length === 0) return null;
  return (
    <div className={`${s.toasts} ${docked ? s.toastsDocked : ''} ${className}`} aria-live="polite">
      {toasts.map((t) => (
        <ToastView key={t.id} toast={t} onClose={() => onClose(t.id)} />
      ))}
    </div>
  );
}
