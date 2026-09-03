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
    // The tail is the settled form of `next`: a rejection must not break the chain for the
    // next waiter. Keep that exact promise so the cleanup below can recognise its own tail.
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

export function orgLockKey(projectId: string, orgId: string): string {
  return `${projectId}\0${orgId}`;
}
