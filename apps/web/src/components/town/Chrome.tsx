'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ko } from '@/i18n/ko';
import { useEscape, useFocusReturn } from './hooks';
import s from './town.module.css';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

function focusFirst(root: HTMLElement | null): void {
  if (!root) return;
  const preferred = root.querySelector<HTMLElement>('[data-autofocus]');
  (preferred ?? root.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
}

/** Right-hand side sheet: titled dialog region, Esc/close button, focus in on open and back on close. */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  headerExtra,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  headerExtra?: ReactNode;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useEscape(onClose);
  useFocusReturn();
  useEffect(() => {
    focusFirst(ref.current);
  }, []);
  return (
    <section ref={ref} className={s.sheet} role="dialog" aria-modal="false" aria-labelledby={titleId}>
      <header className={s.sheetHeader}>
        {headerExtra}
        <h2 id={titleId} className={s.sheetTitle}>
          {title}
        </h2>
        <button type="button" className={s.closeX} onClick={onClose} aria-label={ko.townUi.closePanel}>
          ✕
        </button>
      </header>
      <div className={s.sheetBody}>{children}</div>
      {footer && <div className={s.sheetFooter}>{footer}</div>}
    </section>
  );
}

/**
 * Floating popover anchored at a point (CSS px inside the town root), clamped to the viewport.
 * Closes on Esc and on pointerdown outside.
 */
export function Popover({
  x,
  y,
  onClose,
  label,
  role = 'dialog',
  children,
  anchor = 'point',
}: {
  x: number;
  y: number;
  onClose: () => void;
  label: string;
  role?: 'dialog' | 'menu';
  children: ReactNode;
  anchor?: 'point' | 'below';
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useEscape(onClose);
  useFocusReturn();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.offsetParent instanceof HTMLElement ? el.offsetParent : document.body;
    const pw = parent.clientWidth;
    const ph = parent.clientHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor === 'below' ? x - w : x + 12;
    let top = anchor === 'below' ? y : y - 12;
    if (left + w > pw - 8) left = x - w - 12;
    if (left < 8) left = 8;
    if (top + h > ph - 8) top = ph - h - 8;
    if (top < 60) top = Math.min(60, Math.max(8, ph - h - 8));
    setPos({ left: Math.round(left), top: Math.round(top) });
  }, [x, y, anchor]);

  useEffect(() => {
    focusFirst(ref.current);
  }, []);

  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) closeRef.current();
    };
    // Defer so the click that opened the popover does not immediately close it.
    const t = setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={s.popover}
      role={role}
      aria-label={label}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      data-town-keys="ui"
    >
      {children}
    </div>
  );
}

/** Arrow-key navigation between `[role=menuitem]` buttons inside a menu container. */
export function onMenuKeyDown(e: KeyboardEvent<HTMLElement>): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')];
  if (items.length === 0) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  let next = 0;
  if (e.key === 'ArrowDown') next = i < 0 ? 0 : (i + 1) % items.length;
  else if (e.key === 'ArrowUp') next = i <= 0 ? items.length - 1 : i - 1;
  else if (e.key === 'End') next = items.length - 1;
  items[next]?.focus();
}
