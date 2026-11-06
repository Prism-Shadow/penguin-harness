/**
 * One import or delete at a time per Agent. Everything an import decides about an Agent and does
 * to it — putting back what an interrupted swap left, the backup, reading its config, the refill,
 * what the new State keeps, the swap, the Sessions moving in — happens under the Agent's hold, and
 * so does a delete of the Agent. A second import of the same Agent (a double click, the Web App
 * and the CLI at once, a retry after a client timeout) waits and then sees the first one's
 * result; a delete waits for a running import, so nothing the import writes outlives the Agent,
 * and an import waits for a running delete, so it finds the id free.
 *
 * One instance serves the whole server: the archive routes and the Agent routes both use it.
 */
import { Component } from "@prismshadow/penguin-core/kernel";
import type { AgentHolds } from "../mechanisms/agents.js";

@Component()
export class AgentHoldQueue implements AgentHolds {
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
