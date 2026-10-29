/** A controllable clock for deterministic tests. */
export class FakeClock {
  constructor(private current: Date) {}
  now = (): Date => new Date(this.current);
  set(d: Date | string): void {
    this.current = new Date(d);
  }
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}
