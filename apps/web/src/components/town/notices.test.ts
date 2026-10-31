import { describe, expect, it, vi } from 'vitest';
import { ko } from '@/i18n/ko';
import { noticeFor, type NoticeCtx } from './notices';

const ctx = (over: Partial<NoticeCtx> = {}): NoticeCtx => ({
  meId: 'me',
  nameOf: (id) => ({ alice: '앨리스', bob: '밥' })[id] ?? '',
  viewingDm: () => false,
  openDm: vi.fn(),
  openLog: vi.fn(),
  makeLogPrivate: vi.fn(async () => undefined),
  ...over,
});

const spell = (fromUserId: string, toUserId: string, outcome: 'hit' | 'blocked' | 'combo' | 'raid') =>
  ({ kind: 'spell', msg: { fromUserId, toUserId, spell: 'fireball', outcome } }) as const;

describe('spell toasts', () => {
  it('reach only the two people involved', () => {
    expect(noticeFor(spell('alice', 'bob', 'hit'), ctx())).toBeNull();
    expect(noticeFor(spell('alice', 'bob', 'raid'), ctx())).toBeNull();
  });

  it('tell the caster what happened', () => {
    const name = ko.magic.spells.fireball.name;
    expect(noticeFor(spell('me', 'bob', 'hit'), ctx())?.text).toBe(ko.magic.toast.cast('밥', name));
    expect(noticeFor(spell('me', 'bob', 'blocked'), ctx())?.text).toBe(ko.magic.toast.blocked('밥'));
    expect(noticeFor(spell('me', 'bob', 'combo'), ctx())?.text).toBe(ko.magic.toast.combo('밥'));
  });

  it('greet the target, and leave a shielded target in peace', () => {
    expect(noticeFor(spell('alice', 'me', 'hit'), ctx())?.text).toBe(
      ko.magic.toast.got('앨리스', ko.magic.spells.fireball.name),
    );
    expect(noticeFor(spell('alice', 'me', 'raid'), ctx())?.text).toBe(ko.magic.toast.raid);
    expect(noticeFor(spell('alice', 'me', 'blocked'), ctx())).toBeNull();
  });

  it('explain a refused spell to its caster', () => {
    const err = (code: string) =>
      noticeFor({ kind: 'error', msg: { type: 'social:cast', code } } as never, ctx());
    expect(err('NOT_ACCEPTED')?.text).toBe(ko.magic.toast.notAccepted);
    expect(err('NOT_SHOWN')?.text).toBe(ko.magic.toast.notShown);
    expect(err('RATE_LIMITED')?.text).toBe(ko.magic.toast.rateLimited);
    expect(err('INVALID_PAYLOAD')).toBeNull();
  });
});

describe('other toasts', () => {
  it('a wave toasts only its target', () => {
    const wave = (fromUserId: string, toUserId: string) =>
      noticeFor({ kind: 'emote', msg: { kind: 'wave', fromUserId, toUserId } } as never, ctx());
    expect(wave('alice', 'me')?.text).toBe(ko.townUi.toast.waved('앨리스'));
    expect(wave('alice', 'bob')).toBeNull();
    expect(wave('me', 'bob')).toBeNull();
  });

  it('a DM toasts unless its thread is open', () => {
    const dm = { kind: 'dm', msg: { fromUserId: 'alice', toUserId: 'me', fromName: '앨리스' } } as never;
    expect(noticeFor(dm, ctx())?.text).toBe(ko.townUi.toast.dmFrom('앨리스'));
    expect(noticeFor(dm, ctx({ viewingDm: (id) => id === 'alice' }))).toBeNull();
  });

  it('a call offers the DM', () => {
    const open = vi.fn();
    const t = noticeFor(
      { kind: 'pinged', msg: { fromUserId: 'alice', fromName: '앨리스' } } as never,
      ctx({ openDm: open }),
    );
    expect(t?.text).toBe(ko.townUi.toast.pinged('앨리스'));
    void t?.actions?.[0]?.onClick();
    expect(open).toHaveBeenCalledWith('alice');
  });
});
