/**
 * One import at a time per Agent. Everything an import decides about an Agent and does to it —
 * putting back what an interrupted swap left, the backup, reading its config, the refill, what
 * the new State keeps, the swap, the Sessions moving in — happens under the Agent's hold, so a
 * second import of the same Agent (a double click, the Web App and the CLI at once, a retry
 * after a client timeout) waits and then sees the first one's result.
 */
export class AgentHolds {
  private readonly tails = new Map<string, Promise<void>>();

  /** Runs `work` once every earlier holder of `key` is done. */
  async hold<T>(key: string, work: () => Promise<T>): Promise<T> {
    const before = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    const tail = before.then(() => mine);
    this.tails.set(key, tail);
    await before;
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
