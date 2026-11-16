/**
 * The long-operation cards (src/components/overlays/progress-toasts/progress-toasts.tsx): when a
 * card appears and leaves, what its handle may still change, and the stack as it is drawn.
 *
 * - Given an operation that ends before the reveal delay, no card ever shows.
 * - Given one still running at the reveal delay, its card shows and follows its updates.
 * - When it finishes well, the card shows its finishing words on a full bar, then leaves.
 * - When it fails, the card shows at once (even before the delay) and stays until closed.
 * - Once closed, the handle says so, and nothing it is told changes the card again.
 * - The stack reads out each shown card's title, never its figures; the bar is named by the
 *   title and carries its reading.
 *
 * The portal itself needs a document, which this suite has not; `ProgressStack` is what
 * `ProgressToasts` portals, so the markup is asserted on it.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROGRESS_DONE_STAY_MS,
  PROGRESS_REVEAL_MS,
  ProgressStack,
  progressStore,
  startProgress,
} from "../src/components/overlays/progress-toasts/progress-toasts";
import type { ProgressItem } from "../src/components/overlays/progress-toasts/progress-toasts";
import { renderStatic } from "../src/testing";

const items = () => progressStore.getState().items;
const shown = () => items().filter((i) => i.shown && !i.leaving);

describe("a long operation's card", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    progressStore.setState({ items: [] });
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    progressStore.setState({ items: [] });
  });

  it("never shows for an operation that ends before the reveal delay", () => {
    const card = startProgress({ title: "Deleting agent" });
    vi.advanceTimersByTime(PROGRESS_REVEAL_MS - 1);
    card.finish({ title: "Deleted agent" });
    vi.advanceTimersByTime(PROGRESS_REVEAL_MS);
    expect(items()).toEqual([]);
    expect(card.closed).toBe(true);
  });

  it("shows once the operation has run for the delay, and follows its updates", () => {
    const card = startProgress({ title: "Deleting agent", detail: "Counting" });
    expect(shown()).toEqual([]);
    vi.advanceTimersByTime(PROGRESS_REVEAL_MS);
    card.update({ detail: "10 of 40 removed", value: 10, max: 40 });
    expect(shown()).toEqual([
      expect.objectContaining({
        title: "Deleting agent",
        detail: "10 of 40 removed",
        value: 10,
        max: 40,
        state: "running",
      }),
    ]);
  });

  it("shows the finishing words, then leaves after its stay", () => {
    const card = startProgress({ title: "Deleting agent" });
    vi.advanceTimersByTime(PROGRESS_REVEAL_MS);
    card.finish({ title: "Deleted agent", detail: "40 removed" });
    expect(shown()).toEqual([
      expect.objectContaining({ title: "Deleted agent", detail: "40 removed", state: "done" }),
    ]);
    card.update({ detail: "late reading" });
    expect(shown()[0]?.detail).toBe("40 removed");
    vi.advanceTimersByTime(PROGRESS_DONE_STAY_MS);
    expect(shown()).toEqual([]);
    expect(card.closed).toBe(true);
  });

  it("shows a failure at once and keeps it until it is closed", () => {
    const card = startProgress({ title: "Deleting agent" });
    card.finish({ failed: true, title: "Some files stayed", detail: "EBUSY" });
    expect(shown()).toEqual([expect.objectContaining({ state: "failed", detail: "EBUSY" })]);
    vi.advanceTimersByTime(PROGRESS_DONE_STAY_MS * 10);
    expect(shown()).toHaveLength(1);
    card.close();
    expect(shown()).toEqual([]);
    expect(card.closed).toBe(true);
  });

  it("is let go once closed: later updates and a finish change nothing", () => {
    const card = startProgress({ title: "Deleting agent" });
    vi.advanceTimersByTime(PROGRESS_REVEAL_MS);
    card.close();
    expect(card.closed).toBe(true);
    card.update({ detail: "10 of 40 removed" });
    card.finish({ title: "Deleted agent" });
    vi.advanceTimersByTime(PROGRESS_DONE_STAY_MS * 2);
    expect(items()).toEqual([]);
  });
});

const CARDS: ProgressItem[] = [
  {
    id: 1,
    title: "Deleting agent “writer”",
    detail: "1,200 of 9,000 items removed",
    value: 1200,
    max: 9000,
    state: "running",
    shown: true,
  },
  { id: 2, title: "Some files stayed", detail: "EBUSY", state: "failed", shown: true },
  { id: 3, title: "Not yet shown", state: "running", shown: false },
];

describe("ProgressStack", () => {
  const html = renderStatic(createElement(ProgressStack, { items: CARDS, onClose: () => {} }));

  it("reads out the shown cards' titles, and nothing else", () => {
    const live = /<p class="sr-only" aria-live="polite">([^<]*)<\/p>/.exec(html);
    expect(live?.[1]).toBe("Deleting agent “writer”. Some files stayed");
    expect(html).not.toContain("Not yet shown");
  });

  it("names each bar by its card's title and carries the reading", () => {
    expect(html).toContain('role="progressbar" aria-label="Deleting agent “writer”"');
    expect(html).toMatch(
      /aria-label="Deleting agent “writer”" aria-valuemin="0" aria-valuemax="9000" aria-valuenow="1200"/,
    );
    expect(html).toContain("1,200 of 9,000 items removed");
  });

  it("gives every shown card a close cross", () => {
    expect(html.match(/<button type="button" aria-label="Close"/g)).toHaveLength(2);
  });
});
