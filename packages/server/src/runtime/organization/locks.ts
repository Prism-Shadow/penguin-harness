/**
 * One writer per organization at a time. The scheduler's pass and a route's write both
 * read files, decide, and write files and caches; interleaving them could deliver a chat
 * mention twice or lose a ledger update. A promise chain per key serializes them.
 */
export class KeyedLocks {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.tails.set(
      key,
      next.catch(() => undefined),
    );
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === next) this.tails.delete(key);
    }
  }
}

export function orgLockKey(projectId: string, orgId: string): string {
  return `${projectId}\0${orgId}`;
}
