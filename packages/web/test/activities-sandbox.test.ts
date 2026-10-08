import { describe, expect, it } from "vitest";
import { playUrl } from "../src/features/activities/sandbox";
import { playingModuleRunId } from "../src/features/activities/preview";
import { readFileSync } from "node:fs";

describe("the module the sandbox plays", () => {
  it("changes only after assembly succeeds, while a valid pin keeps its build", () => {
    const old = { runId: "old", kind: "module", status: "succeeded", createdAt: "2026-10-01" };
    const next = { runId: "next", kind: "module", status: "running", createdAt: "2026-10-02" };
    expect(playingModuleRunId([next, old])).toBe("old");
    expect(playingModuleRunId([{ ...next, status: "succeeded" }, old])).toBe("next");
    expect(playingModuleRunId([{ ...next, status: "succeeded" }, old], "old")).toBe("old");
    expect(playingModuleRunId([next, old], "next")).toBe("old");
    expect(playingModuleRunId([{ ...next, status: "succeeded" }, old], "missing")).toBe("next");
    expect(playingModuleRunId([next])).toBeNull();
  });

  it("refreshes status and clears the previous failure when assembly changes", () => {
    const source = readFileSync(
      new URL("../src/features/activities/sandbox-panel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("[refresh, build, revision, moduleRunId, base]");
    expect(source).toContain("setReport(null)");
    expect(source).toContain('revision={`${revision}:${moduleRunId ?? ""}`}');
  });
});

describe("the link that plays an activity", () => {
  it("names the activity, and carries only the overrides an author chose", () => {
    expect(playUrl("p 1", "act_1")).toBe("/api/projects/p%201/activities/act_1/sandbox/play");
    expect(playUrl("p", "a", { language: "es-MX", scene: "intro" })).toBe(
      "/api/projects/p/activities/a/sandbox/play?language=es-MX&scene=intro",
    );
  });
});
