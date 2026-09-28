import { describe, expect, it } from "vitest";
import type { ActivityRunSummary, PipelineState } from "@prismshadow/penguin-server/api";
import { settledPipeline, settledRuns } from "../src/features/activities/run-toasts";

const run = (runId: string, status: ActivityRunSummary["status"], extra = {}) =>
  ({ runId, kind: "audio", status, audio: { assetKey: "hello" }, ...extra }) as ActivityRunSummary;

describe("settledRuns", () => {
  it("announces only runs seen running that have settled since", () => {
    const before = new Map<string, ActivityRunSummary["status"]>([
      ["a", "running"],
      ["b", "running"],
      ["c", "succeeded"],
    ]);
    const out = settledRuns(before, [
      run("a", "succeeded"),
      run("b", "failed"),
      run("c", "succeeded"),
      run("d", "failed"),
    ]);
    expect(out).toEqual([
      { kind: "success", text: "Speech · hello finished." },
      { kind: "error", text: "Speech · hello failed. Its reason is in the history." },
    ]);
  });

  it("announces nothing on a first look", () => {
    expect(settledRuns(new Map(), [run("a", "succeeded")])).toEqual([]);
  });
});

describe("settledPipeline", () => {
  const state = (status: PipelineState["status"], error: string | null = null) =>
    ({ status, error }) as PipelineState;
  it("announces a sequence that was running and has stopped, once", () => {
    expect(settledPipeline("running", state("succeeded"))).toMatchObject({ kind: "success" });
    expect(settledPipeline("running", state("failed", "boom"))).toEqual({
      kind: "error",
      text: "Stopped at a failure: boom",
    });
    expect(settledPipeline("succeeded", state("succeeded"))).toBeNull();
    expect(settledPipeline(null, state("failed"))).toBeNull();
    expect(settledPipeline("running", state("running"))).toBeNull();
  });
});
