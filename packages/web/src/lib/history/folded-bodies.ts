/**
 * The whole values of folded history records, kept by their refs once fetched (the stream
 * controller's `loadBodies`, over `trace-body`).
 *
 * A resync rebuilds the transcript from a fresh window, whose records come folded again. Without
 * the values kept here, an item the reader had unfolded would read whole → preview → loading →
 * whole with no data changing, and its bytes would cross the link twice. With them, the rebuilt
 * item takes its whole values back as it is built, and a fetch still running when the rebuild
 * happened completes into the rebuilt item.
 *
 * Bounded by the characters held: the least recently used value goes first.
 */
import { withElidedBody } from "@prismshadow/penguin-core/interfaces";
import { elidedRecordsOf, takeWholeRecord } from "../amsp/stream-model";
import type { StreamModel, ThinkingItem, ToolCallItem } from "../amsp/stream-model";

/** At most this many characters of whole values are kept for one conversation. */
const HELD_CHARS = 32 * 1024 * 1024;

export class BodyCache {
  readonly #values = new Map<string, string>();
  #chars = 0;

  get(ref: string): string | undefined {
    const value = this.#values.get(ref);
    if (value !== undefined) {
      this.#values.delete(ref);
      this.#values.set(ref, value);
    }
    return value;
  }

  has(ref: string): boolean {
    return this.#values.has(ref);
  }

  set(ref: string, value: string): void {
    const old = this.#values.get(ref);
    if (old !== undefined) {
      this.#chars -= old.length;
      this.#values.delete(ref);
    }
    this.#values.set(ref, value);
    this.#chars += value.length;
    while (this.#chars > HELD_CHARS && this.#values.size > 1) {
      const [oldest, held] = this.#values.entries().next().value as [string, string];
      this.#values.delete(oldest);
      this.#chars -= held.length;
    }
  }
}

/**
 * Puts back, whole, every folded record of `item` whose values are all held. True when nothing
 * of the item is folded any more.
 */
export function takeHeldBodies(item: ToolCallItem | ThinkingItem, held: BodyCache): boolean {
  for (const { slot, elided } of elidedRecordsOf(item)) {
    if (!elided.entries.every((entry) => held.has(entry.ref))) continue;
    let record = elided.record;
    for (const entry of elided.entries) {
      record = withElidedBody(record, entry.path, held.get(entry.ref)!);
    }
    takeWholeRecord(item, slot, record);
  }
  return elidedRecordsOf(item).length === 0;
}

/** Every item of `model`, its children's included, that still holds folded records. */
export function foldedItems(model: StreamModel): (ToolCallItem | ThinkingItem)[] {
  const out: (ToolCallItem | ThinkingItem)[] = [];
  const seen = new Set<StreamModel>();
  const walk = (m: StreamModel): void => {
    if (seen.has(m)) return;
    seen.add(m);
    for (const item of m.items) {
      if (
        (item.kind === "tool_call" || item.kind === "thinking") &&
        elidedRecordsOf(item).length > 0
      ) {
        out.push(item);
      }
    }
    for (const child of m.subagents.values()) walk(child);
  };
  walk(model);
  return out;
}
