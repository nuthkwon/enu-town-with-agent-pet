import { TOWN_EVENTS_CHANNEL, parseTownEvent, type TownEvent } from '@enu/shared';
import pg from 'pg';
import type { Logger } from '../logger';

export interface DbEventsOptions {
  connectionString: string;
  channel?: string;
  logger?: Logger;
  onEvent: (event: TownEvent) => void;
  /** Called after a LISTEN connection is re-established (events may have been missed: resync). */
  onReconnect?: () => void;
  minBackoffMs?: number;
  maxBackoffMs?: number;
}

/**
 * Dedicated `LISTEN enu_den_events` connection (a pooled client cannot hold LISTEN).
 * Reconnects with exponential backoff and asks the room to resync after every reconnect.
 */
export class DbEvents {
  private client: pg.Client | null = null;
  private stopped = true;
  private retryTimer: NodeJS.Timeout | null = null;
  private attempt = 0;
  private everConnected = false;
  private readonly channel: string;

  constructor(private readonly opts: DbEventsOptions) {
    this.channel = opts.channel ?? TOWN_EVENTS_CHANNEL;
    if (!/^[a-z_][a-z0-9_]*$/.test(this.channel)) throw new Error(`invalid LISTEN channel: ${this.channel}`);
  }

  get connected(): boolean {
    return this.client !== null;
  }

  /** Starts listening; resolves after the first attempt (failures keep retrying in the background). */
  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    const c = this.client;
    this.client = null;
    if (c) {
      c.removeAllListeners('notification');
      await c.end().catch(() => undefined);
    }
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const c = new pg.Client({
      connectionString: this.opts.connectionString,
      application_name: 'enu-den-realtime-listen',
      keepAlive: true,
    });
    let failed = false;
    const onFail = (err?: unknown) => {
      if (failed) return;
      failed = true;
      if (this.client === c) this.client = null;
      c.removeAllListeners('notification');
      c.end().catch(() => undefined);
      if (!this.stopped) {
        this.opts.logger?.warn({ err }, 'LISTEN connection lost; reconnecting');
        this.scheduleReconnect();
      }
    };
    c.on('error', onFail);
    c.on('end', () => onFail());
    c.on('notification', (msg) => {
      if (msg.channel !== this.channel || !msg.payload) return;
      const event = parseTownEvent(msg.payload);
      if (!event) {
        this.opts.logger?.warn({ channel: msg.channel }, 'ignoring malformed town event');
        return;
      }
      try {
        this.opts.onEvent(event);
      } catch (err) {
        this.opts.logger?.error({ err, type: event.type }, 'town event handler failed');
      }
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${this.channel}`);
    } catch (err) {
      onFail(err);
      return;
    }
    if (this.stopped || failed) {
      if (!failed) await c.end().catch(() => undefined);
      return;
    }
    this.client = c;
    const isReconnect = this.everConnected || this.attempt > 0;
    this.attempt = 0;
    this.everConnected = true;
    this.opts.logger?.info({ channel: this.channel, reconnect: isReconnect }, 'listening for town events');
    if (isReconnect) this.opts.onReconnect?.();
  }

  private scheduleReconnect(): void {
    if (this.retryTimer || this.stopped) return;
    const min = this.opts.minBackoffMs ?? 500;
    const max = this.opts.maxBackoffMs ?? 30_000;
    const delay = Math.min(max, min * 2 ** this.attempt) * (0.75 + Math.random() * 0.5);
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }
}
