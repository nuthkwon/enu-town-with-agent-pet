/** Fixed-capacity FIFO; pushing into a full buffer drops the oldest item. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private head = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new Error('RingBuffer capacity must be a positive integer');
    this.items = new Array<T | undefined>(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: T): void {
    const tail = (this.head + this.count) % this.capacity;
    this.items[tail] = item;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }

  /** Removes and returns the oldest item. */
  shift(): T | undefined {
    if (this.count === 0) return undefined;
    const item = this.items[this.head];
    this.items[this.head] = undefined;
    this.head = (this.head + 1) % this.capacity;
    this.count--;
    return item;
  }

  peekOldest(): T | undefined {
    return this.count === 0 ? undefined : this.items[this.head];
  }

  peekNewest(): T | undefined {
    return this.count === 0 ? undefined : this.items[(this.head + this.count - 1) % this.capacity];
  }

  clear(): void {
    this.items.fill(undefined);
    this.head = 0;
    this.count = 0;
  }

  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.items[(this.head + i) % this.capacity] as T);
    return out;
  }
}
