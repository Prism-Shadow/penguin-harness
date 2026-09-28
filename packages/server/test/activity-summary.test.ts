import { describe, expect, it } from "vitest";
import { summarize, type SummaryFacts } from "../src/activities/activity-summary.js";

const fresh: SummaryFacts = {
  canonical: true,
  specValid: false,
  plan: "none",
  hasModule: false,
  runningKind: null,
};

describe("summarize", () => {
  it("names the first missing milestone as next", () => {
    expect(summarize(fresh)).toEqual({
      canonical: true,
      hasPlan: false,
      done: 0,
      total: 3,
      status: { kind: "next", milestone: "spec" },
    });
    expect(summarize({ ...fresh, specValid: true }).status).toEqual({
      kind: "next",
      milestone: "mediaPlan",
    });
    expect(summarize({ ...fresh, specValid: true, plan: "current" }).status).toEqual({
      kind: "next",
      milestone: "module",
    });
  });

  it("counts a stale plan as not done and reports it", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "stale", hasModule: true });
    expect(summary.done).toBe(2);
    expect(summary.hasPlan).toBe(true);
    expect(summary.status).toEqual({ kind: "stale", what: "mediaPlan" });
  });

  it("is built when every milestone is reached", () => {
    const summary = summarize({ ...fresh, specValid: true, plan: "current", hasModule: true });
    expect(summary).toMatchObject({ done: 3, status: { kind: "built" } });
  });

  it("puts a running run above everything else", () => {
    const summary = summarize({
      ...fresh,
      specValid: true,
      plan: "stale",
      hasModule: true,
      runningKind: "audio",
    });
    expect(summary.status).toEqual({ kind: "running", runKind: "audio" });
  });

  it("counts an imported module without a plan as built only once the plan exists", () => {
    // A Loom import can play from the checkout before Penguin planned its media.
    const summary = summarize({ ...fresh, specValid: true, hasModule: true });
    expect(summary).toMatchObject({ done: 2, status: { kind: "next", milestone: "mediaPlan" } });
  });

  it("passes canonical through", () => {
    expect(summarize({ ...fresh, canonical: false }).canonical).toBe(false);
  });
});
