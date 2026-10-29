/**
 * Tiny typed event emitter (no Phaser, no DOM) shared by the realtime session, the game bridge and
 * React overlays. Listener errors are isolated so one broken overlay cannot stop the game loop.
 */
export type EventMap = object;
type Args<T> = [T] extends [void] ? [] : [payload: T];
export type Listener<T> = (...args: Args<T>) => void;

export class TypedEmitter<E extends EventMap> {
  private readonly listeners = new Map<keyof E, Set<(payload?: unknown) => void>>();

  on<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    const wrapped = fn as (payload?: unknown) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  once<K extends keyof E>(type: K, fn: Listener<E[K]>): () => void {
    const off = this.on(type, ((...args: Args<E[K]>) => {
      off();
      fn(...args);
    }) as Listener<E[K]>);
    return off;
  }

  emit<K extends keyof E>(type: K, ...args: Args<E[K]>): void {
    const set = this.listeners.get(type);
    if (!set || set.size === 0) return;
    for (const fn of [...set]) {
      try {
        fn(args[0]);
      } catch (err) {
        console.error(`[enu-den] listener for '${String(type)}' failed`, err);
      }
    }
  }

  listenerCount(type: keyof E): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
