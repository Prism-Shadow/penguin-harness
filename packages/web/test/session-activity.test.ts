import { describe, expect, it } from "vitest";
import {
  advanceCompletionHighlights,
  dismissCompletionHighlight,
  sessionActivity,
} from "../src/lib/session-activity";

describe("sessionActivity", () => {
  it("maps server activity first, then the transient completion marker", () => {
    expect(sessionActivity("running", false)).toBe("running");
    expect(sessionActivity("running", true)).toBe("running");
    expect(sessionActivity("compacting", false)).toBe("compacting");
    expect(sessionActivity("idle", true)).toBe("completed");
    expect(sessionActivity("idle", false)).toBeNull();
  });
});

describe("completion highlights", () => {
  it("records active-to-idle and never invents a completion from an idle snapshot", () => {
    const empty = new Set<string>();
    expect(advanceCompletionHighlights(empty, "a", "idle", "idle")).toBe(empty);
    const completed = advanceCompletionHighlights(empty, "a", "running", "idle");
    expect([...completed]).toEqual(["a"]);
  });

  it("keeps the highlight through idle observations and clears it when a new run starts", () => {
    const completed = new Set(["a"]);
    expect(advanceCompletionHighlights(completed, "a", "idle", "idle")).toBe(completed);
    expect([...advanceCompletionHighlights(completed, "a", "idle", "running")]).toEqual([]);
    expect([...advanceCompletionHighlights(completed, "a", "idle", "compacting")]).toEqual([]);
  });

  it("dismisses only the Session that was opened", () => {
    const completed = new Set(["a", "b"]);
    expect([...dismissCompletionHighlight(completed, "a")]).toEqual(["b"]);
    expect(dismissCompletionHighlight(completed, "missing")).toBe(completed);
  });
});
