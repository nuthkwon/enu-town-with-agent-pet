import { describe, expect, it } from 'vitest';
import { CloseCodes, PROTOCOL_VERSION } from '../src/constants';
import { C2S, MSG, isCurrentProtocol } from '../src/messages';

describe('protocol messages', () => {
  it('has no movement messages', () => {
    expect(Object.values(MSG)).not.toContain('step');
    expect(Object.values(MSG)).not.toContain('face');
    expect(Object.values(MSG)).not.toContain('move:correct');
    expect(Object.keys(C2S)).not.toContain('step');
  });

  it('accepts only clients speaking the current protocol', () => {
    expect(isCurrentProtocol({ mapHash: 'abc', protocol: PROTOCOL_VERSION })).toBe(true);
    expect(isCurrentProtocol({ mapHash: 'abc' })).toBe(false);
    expect(isCurrentProtocol({ protocol: PROTOCOL_VERSION - 1 })).toBe(false);
    expect(isCurrentProtocol({ protocol: String(PROTOCOL_VERSION) })).toBe(false);
    expect(isCurrentProtocol(undefined)).toBe(false);
    expect(CloseCodes.ProtocolMismatch).toBe(4111);
  });

  it('status:set takes a manual status or auto with an optional duration', () => {
    expect(C2S.statusSet.parse({ status: 'focus', duration: '30m' })).toEqual({ status: 'focus', duration: '30m' });
    expect(C2S.statusSet.parse({ status: 'auto' })).toEqual({ status: 'auto' });
    expect(C2S.statusSet.parse({ status: 'break', text: '점심' })).toEqual({ status: 'break', text: '점심' });
    expect(C2S.statusSet.safeParse({ status: 0 }).success).toBe(false);
    expect(C2S.statusSet.safeParse({ status: 'away', duration: '3h' }).success).toBe(false);
    expect(C2S.statusSet.safeParse({ status: 'away', text: '가'.repeat(81) }).success).toBe(false);
  });

  it('chat is room-only (a stale channel key is stripped)', () => {
    expect(C2S.chatSend.parse({ channel: 'nearby', text: '안녕하세요', clientMsgId: 'm-000001' })).toEqual({
      text: '안녕하세요',
      clientMsgId: 'm-000001',
    });
  });

  it('a wave names its target', () => {
    expect(C2S.wave.safeParse({}).success).toBe(false);
    expect(C2S.wave.parse({ toUserId: 'u1' })).toEqual({ toUserId: 'u1' });
  });
});
