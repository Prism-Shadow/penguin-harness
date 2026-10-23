/**
 * Given running work, a snapshot has no premature result.
 * Given a completed main task, only its final answer is returned, never child/tool output.
 * Given a failed or empty new task, an old answer must not be reused.
 * Given an automatic request retry that later succeeds, its recoverable error does not win.
 */
import { describe, expect, it } from "vitest";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { workbenchResult } from "../src/workbenches/result.js";
const message = (payload: object, origin?: string[]): AmspRecord =>
  ({
    timestamp: "2026-10-14T00:00:00Z",
    type: "model_msg",
    payload,
    ...(origin ? { origin } : {}),
  }) as AmspRecord;
const ask = (text: string) => message({ type: "text", role: "user", text });
const answer = (text: string) =>
  message({ type: "text", role: "assistant", text, stop_reason: "completed" });
describe("workbench task results", () => {
  it("returns running without a premature answer", () => {
    expect(workbenchResult("running", [ask("q"), answer("partial")])).toEqual({
      status: "running",
      text: "",
      error: null,
    });
  });
  it("returns the main task's final answer without child output", () => {
    expect(
      workbenchResult("idle", [
        ask("q"),
        answer("Final report"),
        message({ type: "text", role: "assistant", text: "child", stop_reason: "completed" }, [
          "child",
        ]),
      ]),
    ).toEqual({ status: "completed", text: "Final report", error: null });
  });
  it("does not reuse an old answer when the new task fails or has none", () => {
    const before = [ask("old"), answer("old report"), ask("new")];
    expect(workbenchResult("idle", before).status).toBe("failed");
    expect(
      workbenchResult("idle", [...before, message({ type: "abort", reason: "cancelled" })]),
    ).toEqual({ status: "failed", text: "", error: "cancelled" });
    expect(
      workbenchResult("idle", [
        ...before,
        answer("intermediate"),
        message({ type: "request_end", status: "failed", error_message: "provider down" }),
      ]),
    ).toEqual({ status: "failed", text: "", error: "provider down" });
  });
  it("returns a successful retry instead of its earlier request error", () => {
    expect(
      workbenchResult("idle", [
        ask("q"),
        message({ type: "request_end", status: "failed", error_message: "temporary" }),
        answer("recovered"),
      ]),
    ).toEqual({ status: "completed", text: "recovered", error: null });
  });
});
