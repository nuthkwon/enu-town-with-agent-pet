/** Pure helpers for the chat dock and composers (unit-tested; no React/DOM). */

export type ChatChannel = 'nearby' | 'room';

export interface ChatLine {
  key: string;
  id: string | null;
  clientMsgId: string | null;
  kind: ChatChannel;
  fromUserId: string;
  fromName: string;
  text: string;
  createdAt: string;
  state: 'sent' | 'pending' | 'failed';
  error?: string;
}

export const MAX_CHAT_LINES = 150;

/** Merges an incoming line: replaces my own pending echo, ignores duplicates, caps the history. */
export function mergeLine(lines: readonly ChatLine[], incoming: ChatLine, myUserId: string): ChatLine[] {
  if (incoming.id && lines.some((l) => l.id === incoming.id)) return lines as ChatLine[];
  if (incoming.fromUserId === myUserId) {
    const i = lines.findIndex(
      (l) => l.state === 'pending' && l.kind === incoming.kind && l.text === incoming.text && l.fromUserId === myUserId,
    );
    if (i >= 0) {
      const next = [...lines];
      next[i] = { ...incoming, key: lines[i]?.key ?? incoming.key };
      return next;
    }
  }
  const next = [...lines, incoming];
  return next.length > MAX_CHAT_LINES ? next.slice(next.length - MAX_CHAT_LINES) : next;
}

/** True for Enter presses that should send (never while an IME is composing Hangul). */
export function isSendEnter(e: {
  key: string;
  shiftKey: boolean;
  nativeEvent: { isComposing?: boolean };
  keyCode?: number;
}): boolean {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  if (e.nativeEvent.isComposing || e.keyCode === 229) return false;
  return true;
}
