import { EventEmitter } from 'node:events';

/**
 * Wakes a parked Claude Code channel long-poll as soon as the owner writes to a pet. Every pet-message write
 * happens in this web process, so an in-process emitter is enough; the poll also re-checks the database every few
 * seconds, which covers a second web instance. Kept on globalThis so dev reloads share one emitter.
 */
const holder = globalThis as unknown as { __enuPetWake?: EventEmitter };
const emitter = (holder.__enuPetWake ??= new EventEmitter().setMaxListeners(0));

/** Call after the transaction that stored an owner message committed. */
export function wakeOwner(userId: string): void {
  emitter.emit(userId);
}

/** Resolves when `userId` writes to a pet, after `ms`, or when `signal` aborts, whichever comes first. */
export function waitForOwner(userId: string, ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted || ms <= 0) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      emitter.off(userId, done);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    emitter.on(userId, done);
    signal?.addEventListener('abort', done, { once: true });
  });
}
