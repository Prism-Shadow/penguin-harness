/**
 * useArrived (src/motion/use-arrived.ts): what decides whether a change was watched — the
 * difference between the value a component mounted with and the one it renders now.
 *
 * - Given the value it mounted with, nothing has arrived: a page that loads moves nothing.
 * - Given a different value (a run settled, an entry moved, the list regrouped), it has.
 *
 * The hook keeps the answer once it has changed, so a value switched back to where it started
 * still counts; that latch is a state update a static render cannot reach, and the components'
 * suites check the first render (no `data-reveal` on mount).
 */
import { describe, expect, it } from "vitest";
import { arrived } from "../src/motion/use-arrived";

describe("arrived", () => {
  it("the value a component mounted with has not arrived; a different one has", () => {
    expect(arrived("running", "running")).toBe(false);
    expect(arrived("running", "done")).toBe(true);
    expect(arrived("agent", "workspace")).toBe(true);
  });
});
