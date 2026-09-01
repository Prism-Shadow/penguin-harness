import type { OmniMessage } from "../omnimessage/index.js";

/**
 * Merge queue: lets multiple concurrent producers push OmniMessage entries; a single
 * consumer pulls and yields them in push order. Finishes once all producers are done and
 * the queue is drained. It is the engine's merge point for a turn's concurrent streams
 * (the LLM consumer plus N tool executions — see /docs/message-flow § "The merge point:
 * MergeQueue"), and the same pump turns a context opener's published records into live
 * yields (see `pumpOpener`): the engine's post-compaction `openNextContext` and the Session's
 * first-run bootstrap deliver through one mechanism.
 */
export class MergeQueue {
  private items: OmniMessage[] = [];
  private producers = 0;
  private wake: (() => void) | null = null;

  /** Registers a producer. */
  addProducer(): void {
    this.producers += 1;
  }

  /** Deregisters a producer (its stream has finished). */
  removeProducer(): void {
    this.producers -= 1;
    this.signal();
  }

  /** Pushes a message and wakes the consumer. */
  push(msg: OmniMessage): void {
    this.items.push(msg);
    this.signal();
  }

  private signal(): void {
    if (this.wake) {
      const w = this.wake;
      this.wake = null;
      w();
    }
  }

  /** Takes the next message; waits if empty but producers remain; returns null if empty and no producers remain. */
  async next(): Promise<OmniMessage | null> {
    for (;;) {
      if (this.items.length > 0) return this.items.shift()!;
      if (this.producers === 0) return null;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}

/**
 * Runs a context opener — a procedure that publishes records through an `emit` callback while
 * it works — behind a MergeQueue the caller drains: each record becomes a queue item the
 * moment it is published, the queue closes when the opener settles, and the opener's outcome
 * is `result`. A rejection is deferred to that promise (never reported as unhandled while the
 * queue is still being drained), so the caller pumps the queue to its end, then awaits
 * `result`. The engine's post-compaction open and the Session's first-run bootstrap are the
 * two pumps.
 */
export function pumpOpener<T>(open: (emit: (msg: OmniMessage) => void) => T | Promise<T>): {
  queue: MergeQueue;
  result: Promise<T>;
} {
  const queue = new MergeQueue();
  queue.addProducer();
  const result = (async () => {
    try {
      return await open((msg) => queue.push(msg));
    } finally {
      queue.removeProducer();
    }
  })();
  void result.catch(() => {});
  return { queue, result };
}
