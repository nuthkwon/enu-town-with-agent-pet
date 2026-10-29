import { zonedTimeToUtc } from '@enu/shared';
import type { Clock } from '../../src/clock';

export const TZ = 'Asia/Seoul';
export const MIN = 60_000;

/** Wall-clock time in Asia/Seoul -> instant. */
export const kst = (y: number, mo: number, d: number, h = 0, mi = 0): Date =>
  zonedTimeToUtc(y, mo, d, h, mi, TZ);

/** Manually driven clock for unit tests. */
export class ManualClock implements Clock {
  constructor(private t: number) {}
  now = (): Date => new Date(this.t);
  set(d: Date): void {
    this.t = d.getTime();
  }
  advance(ms: number): void {
    this.t += ms;
  }
}
