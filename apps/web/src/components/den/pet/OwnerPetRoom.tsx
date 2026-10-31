'use client';

import {
  APP_TIMEZONE_DEFAULT,
  localDateKey,
  type MyPetDto,
  type OwnerPetDto,
  type OwnerPetMessageDto,
  type PetThreadPageDto,
  type Visibility,
} from '@enu/shared';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useFxLayer } from '@/components/fx/FxSprite';
import { Badge, Button, cx } from '@/components/ui';
import { formatHm } from '@/components/town/format';
import { ko } from '@/i18n/ko';
import { ApiRequestError, apiFetch, describeError } from '@/lib/api';
import { useOfficeOpen } from '@/realtime/useRealtime';
import { playMine } from '@/sound/engine';
import { useDen } from '../DenProvider';
import { companionState, type CompanionExpr } from '../model/companionState';
import { buildTimeline, lastUnreadReply, mergeLogs, prependPage } from '../model/timeline';
import { waitHint } from '../model/waitHint';
import { FamiliarStage } from './FamiliarStage';
import { Timeline } from './Timeline';
import s from '../den.module.css';

const PAGE = 30;

/** Whether this tab is in front (a reply that arrived while it was hidden is marked read on return). */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    on();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** When a moment of joy ends (the companion is happy until then). */
function happyFor(ms: number): number {
  return Date.now() + ms;
}

function newClientId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * My room with one of my pets (owner only). Replies come only from my own Claude; the companion reacts to this
 * room alone and its state is never sent anywhere.
 */
export function OwnerPetRoom({ pet }: { pet: OwnerPetDto }) {
  const { me, session, channel, petSignal, reloadPets } = useDen();
  const officeOpen = useOfficeOpen(session);
  const [items, setItems] = useState<OwnerPetMessageDto[]>([]);
  const [logs, setLogs] = useState<PetThreadPageDto<OwnerPetMessageDto>['workLogs']>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(pet.effectiveDefaultVisibility);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [piiText, setPiiText] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [lastKeyAt, setLastKeyAt] = useState<number | null>(null);
  const [lastReply, setLastReply] = useState<{ at: number; length: number } | null>(null);
  const [happyUntil, setHappyUntil] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [pinned, setPinned] = useState<MyPetDto | null>(null);
  const seenReplies = useRef<Set<string> | null>(null);
  const readSent = useRef<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  /** Older pages were loaded: a refetch of the newest page keeps their cursor and cards. */
  const olderLoaded = useRef(false);
  /** Keep the view at the newest message (unless I scrolled up to read). */
  const stick = useRef(true);
  /** Scroll height before an older page was put in front, to keep what I was reading in place. */
  const prependFrom = useRef<number | null>(null);
  const visible = useDocumentVisible();
  const t = ko.den.pet;
  const router = useRouter();
  const pathname = usePathname();
  const hatch = useSearchParams().get('hatch') === '1';
  const [replySignal, setReplySignal] = useState(0);
  const [questBusy, setQuestBusy] = useState<string | null>(null);
  const questFx = useFxLayer();
  const questsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setVisibility(pet.effectiveDefaultVisibility), [pet.id, pet.effectiveDefaultVisibility]);

  /** Loads the newest page; new replies make the companion talk and are announced once. */
  const loadLatest = useCallback(async () => {
    const page = await apiFetch<PetThreadPageDto<OwnerPetMessageDto>>(
      `/api/v1/me/pets/${pet.id}/thread?limit=${PAGE}`,
    );
    const replies = page.items.filter((m) => m.author === 'pet');
    if (seenReplies.current) {
      const fresh = replies.filter((m) => !seenReplies.current!.has(m.id));
      const newest = fresh[fresh.length - 1];
      if (newest) {
        setLastReply({ at: Date.now(), length: newest.text.length });
        setAnnounce(`${pet.name}: ${newest.text}`);
        setReplySignal((n) => n + 1);
      }
    }
    seenReplies.current = new Set([...(seenReplies.current ?? []), ...replies.map((m) => m.id)]);
    setItems((shown) => {
      const keep = shown.filter((m) => !page.items.some((p) => p.id === m.id));
      const oldestNew = page.items[0]?.createdAt ?? '';
      return [...keep.filter((m) => m.createdAt < oldestNew), ...page.items];
    });
    setLogs((shown) => mergeLogs(shown, page.workLogs));
    setNextCursor((c) => (olderLoaded.current ? c : page.nextCursor));
    setLoaded(true);
  }, [pet.id, pet.name]);

  /** Starts the room over from the newest page (another pet, or after hiding the history). */
  const reload = useCallback(() => {
    setItems([]);
    setLogs([]);
    setNextCursor(null);
    setLoaded(false);
    olderLoaded.current = false;
    stick.current = true;
    readSent.current = null;
    return loadLatest().catch(() => setLoaded(true));
  }, [loadLatest]);

  useEffect(() => {
    seenReplies.current = null;
    void reload();
  }, [pet.id, reload]);

  useEffect(() => {
    if (petSignal.n === 0) return;
    if (petSignal.petId === null || petSignal.petId === pet.id) loadLatest().catch(() => undefined);
  }, [petSignal, pet.id, loadLatest]);

  // Reminders and to-dos my Claude left for me (shown in the default pet's room).
  useEffect(() => {
    if (!pet.isDefault) return;
    const ctrl = new AbortController();
    apiFetch<MyPetDto>('/api/v1/me/pet', { signal: ctrl.signal })
      .then(setPinned)
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [pet.isDefault, petSignal.n]);

  // Reading the room marks my pet's replies read (a current value only; no read time is stored).
  useEffect(() => {
    const unread = lastUnreadReply(items);
    if (!unread || readSent.current === unread.id || !visible) return;
    readSent.current = unread.id;
    apiFetch(`/api/v1/me/pets/${pet.id}/read`, { method: 'POST', body: { last_message_id: unread.id } })
      .then(() => reloadPets())
      .catch(() => undefined);
  }, [items, pet.id, reloadPets, visible]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prependFrom.current !== null) {
      el.scrollTop += el.scrollHeight - prependFrom.current;
      prependFrom.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [items.length, logs.length]);

  const loadOlder = async () => {
    if (!nextCursor) return;
    const page = await apiFetch<PetThreadPageDto<OwnerPetMessageDto>>(
      `/api/v1/me/pets/${pet.id}/thread?limit=${PAGE}&cursor=${encodeURIComponent(nextCursor)}`,
    );
    olderLoaded.current = true;
    prependFrom.current = scroller.current?.scrollHeight ?? null;
    setItems((shown) => prependPage(shown, page.items));
    setLogs((shown) => [...page.workLogs.filter((l) => !shown.some((x) => x.id === l.id)), ...shown]);
    setNextCursor(page.nextCursor);
  };

  const send = async (text: string, vis: Visibility) => {
    setSending(true);
    setError(null);
    try {
      const message = await apiFetch<OwnerPetMessageDto>(`/api/v1/me/pets/${pet.id}/messages`, {
        method: 'POST',
        body: { text, client_msg_id: newClientId(), visibility: vis },
      });
      stick.current = true;
      setItems((shown) => [...shown.filter((m) => m.id !== message.id), message]);
      setDraft('');
      playMine('msg.send');
      setPiiText(null);
      setHappyUntil(Date.now() + 1600);
      reloadPets();
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'pii_public') setPiiText(text);
      else setError(e instanceof ApiRequestError ? describeError(e) : t.sendFailed);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    setLastKeyAt(Date.now());
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (draft.trim() && !sending) void send(draft, visibility);
    }
  };

  const patchVisibility = async (m: OwnerPetMessageDto) => {
    const next: Visibility = m.visibility === 'company' ? 'private' : 'company';
    setError(null);
    try {
      const updated = await apiFetch<OwnerPetMessageDto>(`/api/v1/me/pets/${pet.id}/messages/${m.id}`, {
        method: 'PATCH',
        body: { visibility: next },
      });
      setItems((shown) => shown.map((x) => (x.id === updated.id ? updated : x)));
    } catch (e) {
      setError(describeError(e));
    }
  };

  const remove = async (m: OwnerPetMessageDto) => {
    if (!window.confirm(t.deleteConfirm)) return;
    await apiFetch(`/api/v1/me/pets/${pet.id}/messages/${m.id}`, { method: 'DELETE' });
    setItems((shown) => shown.filter((x) => x.id !== m.id && x.inReplyTo !== m.id));
    reloadPets();
  };

  const hideHistory = async () => {
    if (!window.confirm(t.hideHistoryConfirm)) return;
    await apiFetch(`/api/v1/me/pets/${pet.id}/hide-history`, { method: 'POST' });
    // Older pages I already loaded changed too: start over from the newest page.
    await reload();
  };

  /** 오늘의 퀘스트: completing a to-do celebrates on my screen only (the same PATCH as /me). */
  const completeQuest = async (todoId: string, el: HTMLElement) => {
    setQuestBusy(todoId);
    setError(null);
    try {
      await apiFetch(`/api/v1/me/todos/${encodeURIComponent(todoId)}`, {
        method: 'PATCH',
        body: { status: 'done' },
      });
      const box = questsRef.current?.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (box)
        questFx.play('ui/quest-done', {
          x: r.left - box.left + r.width / 2,
          y: r.top - box.top + r.height / 2,
        });
      playMine('quest.done');
      setAnnounce(ko.magic.quests.cleared);
      setHappyUntil(happyFor(1600));
      setPinned((p) => (p ? { ...p, todos: p.todos.filter((x) => x.id !== todoId) } : p));
    } catch {
      setError(ko.magic.quests.failed);
    } finally {
      setQuestBusy(null);
    }
  };

  const pending = items.filter((m) => m.author === 'owner' && m.answerState !== 'answered');
  const hint = waitHint({
    route: pet.replyRoute,
    channelPaired: channel?.paired ?? false,
    channelLive: channel?.live ?? false,
    linkState: me.linkState,
    officeOpen,
  });
  const mood = companionState({
    now,
    composer: { focused, draftLength: draft.length, lastKeyAt },
    pendingSince: pending[0] ? Date.parse(pending[0].createdAt) : null,
    wait: hint,
    lastReply,
    happyUntil,
  });
  useEffect(() => {
    if (mood.nextAt === null) return;
    const timer = setTimeout(() => setNow(Date.now()), Math.max(50, mood.nextAt - Date.now()));
    return () => clearTimeout(timer);
  }, [mood.nextAt]);
  useEffect(() => setNow(Date.now()), [focused, draft.length, lastKeyAt, lastReply, happyUntil, items]);

  const entries = useMemo(() => buildTimeline(items, logs), [items, logs]);
  const todayKey = localDateKey(new Date(), me.timezone || APP_TIMEZONE_DEFAULT);
  const expr: CompanionExpr = mood.expr;
  const notice = pet.effectiveDefaultVisibility;
  const nudges = (pinned?.nudges ?? []).filter((n) => ['pending', 'shown', 'snoozed'].includes(n.status));
  const todos = (pinned?.todos ?? []).filter((x) => x.status === 'open');

  return (
    <>
      <header className={s.roomHead}>
        <FamiliarStage
          pet={pet}
          expr={expr}
          replySignal={replySignal}
          hatch={hatch}
          onHatched={() => router.replace(pathname)}
          onPlayed={() => setHappyUntil(happyFor(1200))}
        />
        <div>
          <h1 className={s.roomTitle} tabIndex={-1} data-companion-expr={expr}>
            {pet.name}
          </h1>
          <div className={s.chips}>
            {pet.isDefault && <Badge tone="lavender">{t.defaultBadge}</Badge>}
            <Badge tone="sky">{t.route[pet.replyRoute]}</Badge>
            {channel?.paired && (
              <Badge tone={channel.live ? 'mint' : 'gray'} dot>
                {channel.live ? t.channel.live : t.channel.paired}
              </Badge>
            )}
          </div>
        </div>
        <div className={s.headActions}>
          <Button size="sm" variant="ghost" onClick={hideHistory}>
            {t.hideHistory}
          </Button>
          <Link href="/settings/pets">{t.settingsLink}</Link>
        </div>
      </header>
      <p className={cx(s.notice, notice === 'private' && s.noticePrivate)}>
        {notice === 'private' && items.some((m) => m.visibility === 'company')
          ? t.visibilityNotice.privateWithShared
          : t.visibilityNotice[notice]}
      </p>
      {pet.isDefault && nudges.length > 0 && (
        <div className={s.pinned} aria-label={t.pinned}>
          {nudges.map((n) => (
            <span key={n.id} className={s.pinnedItem}>
              <span aria-hidden="true">✦</span>
              {n.text}
            </span>
          ))}
        </div>
      )}
      {pet.isDefault && todos.length > 0 && (
        <div className={s.quests} ref={questsRef} aria-label={ko.magic.quests.title}>
          <span className={s.questsTitle}>{ko.magic.quests.title}</span>
          {todos.slice(0, 5).map((x) => (
            <span key={x.id} className={s.quest}>
              <span aria-hidden="true">☐</span>
              {x.title}
              {x.dueAt && <span className={s.meta}>{t.due(formatHm(x.dueAt))}</span>}
              <button
                type="button"
                className={s.questDone}
                disabled={questBusy === x.id}
                aria-label={ko.magic.quests.doneLabel(x.title)}
                onClick={(e) => void completeQuest(x.id, e.currentTarget)}
              >
                {ko.magic.quests.done}
              </button>
            </span>
          ))}
          {questFx.layer}
        </div>
      )}
      <div
        className={s.timeline}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {nextCursor && (
          <div className={s.older}>
            <Button size="sm" variant="secondary" onClick={() => void loadOlder()}>
              {t.older}
            </Button>
          </div>
        )}
        {loaded && items.length === 0 && logs.length === 0 && (
          <div className={s.empty}>
            <strong>{t.emptyTitle}</strong>
            <p>{t.emptyBody}</p>
          </div>
        )}
        <Timeline
          entries={entries}
          todayKey={todayKey}
          petName={pet.name}
          label={t.roomLabel(pet.name)}
          renderMeta={(m) => (
            <span className={s.meta}>
              {m.author === 'pet' && m.source && <span>{t.replyBy[m.source]}</span>}
              <span>{formatHm(m.createdAt)}</span>
              <span>{t.visibilityOf[m.visibility]}</span>
              <button type="button" className={s.metaButton} onClick={() => void patchVisibility(m)}>
                {m.visibility === 'company' ? t.hide : t.show}
              </button>
              {m.author === 'owner' && (
                <button type="button" className={s.metaButton} onClick={() => void remove(m)}>
                  {t.delete}
                </button>
              )}
            </span>
          )}
        />
        {pending.length > 0 && (
          <p className={s.waitHint} data-wait={hint}>
            {t.wait[hint]}
          </p>
        )}
      </div>
      <div className={s.srOnly} role="status" aria-live="polite">
        {announce}
      </div>
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim() && !sending) void send(draft, visibility);
        }}
      >
        {piiText !== null && (
          <div className={s.alert} role="alert">
            <strong>{t.piiTitle}</strong>
            <p style={{ margin: '4px 0 0' }}>{t.piiBody}</p>
            <div className={s.alertActions}>
              <Button size="sm" onClick={() => void send(piiText, 'private')}>
                {t.sendPrivate}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setPiiText(null)}>
                {t.edit}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div className={s.alert} role="alert">
            {error}
          </div>
        )}
        <div className={s.composerRow}>
          <textarea
            className={s.composerInput}
            value={draft}
            rows={1}
            maxLength={2000}
            aria-label={t.composerLabel(pet.name)}
            placeholder={t.placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
          />
          <Button type="submit" disabled={sending || !draft.trim()}>
            {sending ? t.sending : t.send}
          </Button>
        </div>
        <div className={s.composerBar}>
          <label>
            {t.sendAs}{' '}
            <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
              <option value="company">{t.visibilityOf.company}</option>
              <option value="private">{t.visibilityOf.private}</option>
            </select>
          </label>
          <span>{t.hiddenReplies}</span>
        </div>
      </form>
    </>
  );
}
