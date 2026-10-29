import type { LinkState, PetReplyRoute } from '@enu/shared';

/**
 * What the owner is told while a message waits (owner only, never shown to anyone else):
 * - live: a paired Claude Code is listening, the answer comes soon;
 * - checkin: the next check-in of the owner's Claude answers it (office hours);
 * - nextBusinessDay: outside office hours the check-in answers on the next business day;
 * - channelOffline: this pet answers only through Claude Code, which is not listening now;
 * - notLinked: nothing can answer yet (no Claude connected for this route).
 */
export type WaitHint = 'live' | 'checkin' | 'nextBusinessDay' | 'channelOffline' | 'notLinked';

export interface WaitInput {
  route: PetReplyRoute;
  channelPaired: boolean;
  channelLive: boolean;
  linkState: LinkState;
  /** Office hours as the town knows them; null while unknown. */
  officeOpen: boolean | null;
}

export function waitHint(i: WaitInput): WaitHint {
  if (i.route !== 'checkin' && i.channelLive) return 'live';
  if (i.route === 'channel') return i.channelPaired ? 'channelOffline' : 'notLinked';
  if (i.linkState === 'not_linked') return i.channelPaired ? 'channelOffline' : 'notLinked';
  return i.officeOpen === false ? 'nextBusinessDay' : 'checkin';
}
