'use client';

import type { Paginated } from '@enu/shared';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { DirectorySnapshot, TownDirectory } from '@/game/directory';
import { getJson } from './api';

export function useDirectory(directory: TownDirectory): DirectorySnapshot {
  const subscribe = useCallback((cb: () => void) => directory.on('change', cb), [directory]);
  return useSyncExternalStore(subscribe, directory.getSnapshot, directory.getSnapshot);
}

/** Current time, refreshed every `intervalMs` (keeps relative times like 'N분 전' fresh). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface FetchState<T> {
  data: T | null;
  error: boolean;
  loading: boolean;
  reload: () => void;
}

/** GET JSON when `url` is set; aborts on change/unmount. */
export function useFetch<T>(url: string | null): FetchState<T> {
  const [state, setState] = useState<{
    url: string | null;
    data: T | null;
    error: boolean;
    loading: boolean;
  }>({
    url: null,
    data: null,
    error: false,
    loading: false,
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!url) return;
    const ctrl = new AbortController();
    setState((s) => ({ url, data: s.url === url ? s.data : null, error: false, loading: true }));
    getJson<T>(url, ctrl.signal)
      .then((data) => setState({ url, data, error: false, loading: false }))
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setState({ url, data: null, error: true, loading: false });
      });
    return () => ctrl.abort();
  }, [url, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const current = state.url === url;
  return {
    data: current ? state.data : null,
    error: current ? state.error : false,
    loading: url !== null && (!current || state.loading),
    reload,
  };
}

export interface PagedState<T> {
  items: T[];
  nextCursor: string | null;
  loading: boolean;
  error: boolean;
  loadMore: () => void;
  reload: () => void;
}

/** Cursor pagination over `Paginated<T>` responses; `key` resets the list. */
export function usePaged<T>(key: string | null, makeUrl: (cursor: string | null) => string): PagedState<T> {
  const [state, setState] = useState<{
    key: string | null;
    items: T[];
    next: string | null;
    loading: boolean;
    error: boolean;
  }>({ key: null, items: [], next: null, loading: false, error: false });
  const makeUrlRef = useRef(makeUrl);
  useEffect(() => {
    makeUrlRef.current = makeUrl;
  });
  const ctrlRef = useRef<AbortController | null>(null);

  const load = useCallback((k: string, cursor: string | null) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setState((s) =>
      s.key === k
        ? { ...s, loading: true, error: false }
        : { key: k, items: [], next: null, loading: true, error: false },
    );
    getJson<Paginated<T>>(makeUrlRef.current(cursor), ctrl.signal)
      .then((page) =>
        setState((s) => ({
          key: k,
          items: cursor && s.key === k ? [...s.items, ...(page?.items ?? [])] : [...(page?.items ?? [])],
          next: page?.nextCursor ?? null,
          loading: false,
          error: false,
        })),
      )
      .catch((e: unknown) => {
        if (ctrl.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return;
        setState((s) => ({ ...s, key: k, loading: false, error: true }));
      });
  }, []);

  useEffect(() => {
    if (!key) return;
    load(key, null);
    return () => ctrlRef.current?.abort();
  }, [key, load]);

  const current = state.key === key;
  return {
    items: current ? state.items : [],
    nextCursor: current ? state.next : null,
    loading: key !== null && (!current || state.loading),
    error: current ? state.error : false,
    loadMore: () => {
      if (key && state.next && !state.loading) load(key, state.next);
    },
    reload: () => {
      if (key) load(key, null);
    },
  };
}

function isEditable(el: EventTarget | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
  );
}

/** True while a text field has focus (typing counts as busy for the pet: bubbles wait). */
export function useTextFocus(): boolean {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const onIn = (e: FocusEvent) => {
      if (isEditable(e.target)) setFocused(true);
    };
    const onOut = (e: FocusEvent) => {
      if (isEditable(e.target) && !isEditable(e.relatedTarget)) setFocused(false);
    };
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    return () => {
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
    };
  }, []);
  return focused;
}

/* Escape handling: one window listener, a stack of handlers; only the top-most (latest opened)
 * overlay closes, so Esc closes a popover before the sheet underneath it. */
const escapeStack: Array<{ current: () => void }> = [];
function onEscapeKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.isComposing) return;
  const top = escapeStack.at(-1);
  if (!top) return;
  e.stopPropagation();
  e.preventDefault();
  top.current();
}

/** Calls `onEscape` on Escape while mounted (and `active`), innermost overlay first. */
export function useEscape(onEscape: () => void, active = true): void {
  const ref = useRef(onEscape);
  useEffect(() => {
    ref.current = onEscape;
  });
  useEffect(() => {
    if (!active) return;
    const entry = { current: () => ref.current() };
    escapeStack.push(entry);
    if (escapeStack.length === 1) window.addEventListener('keydown', onEscapeKey, true);
    return () => {
      const i = escapeStack.indexOf(entry);
      if (i >= 0) escapeStack.splice(i, 1);
      if (escapeStack.length === 0) window.removeEventListener('keydown', onEscapeKey, true);
    };
  }, [active]);
}

/** Remembers the focused element on mount and restores focus to it on unmount. */
export function useFocusReturn(): void {
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
    };
  }, []);
}
