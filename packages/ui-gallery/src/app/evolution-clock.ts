/** Only the automatic walkthrough's timers pause; the real app stays interactive. */
interface Pending {
  remaining: number;
  startedAt: number;
  timer?: ReturnType<typeof setTimeout>;
  run: () => void;
}

export class EvolutionClock {
  private paused = false;
  private readonly pending = new Set<Pending>();

  schedule(run: () => void, delay: number): () => void {
    const entry: Pending = { remaining: delay, startedAt: Date.now(), run };
    this.pending.add(entry);
    if (!this.paused) this.arm(entry);
    return () => {
      clearTimeout(entry.timer);
      this.pending.delete(entry);
    };
  }

  private arm(entry: Pending): void {
    entry.startedAt = Date.now();
    entry.timer = setTimeout(() => {
      this.pending.delete(entry);
      entry.run();
    }, entry.remaining);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    for (const entry of this.pending) {
      if (paused) {
        clearTimeout(entry.timer);
        entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.startedAt));
      } else {
        this.arm(entry);
      }
    }
  }

  dispose(): void {
    for (const entry of this.pending) clearTimeout(entry.timer);
    this.pending.clear();
  }
}
