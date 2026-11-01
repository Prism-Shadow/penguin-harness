/**
 * Workflow definitions (src/organization/workflow-files.ts): the bidding template parses,
 * malformed YAML is reported rather than repaired, snapshots replay the event stream.
 */
import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  initialSnapshot,
  parseWorkflowDefinition,
  replayEvents,
  serializeWorkflowDefinition,
} from "../src/organization/workflow-files.js";
import { BIDDING_V1_YAML } from "../src/organization/templates/bidding-v1.js";

async function biddingTemplate(): Promise<string> {
  return fs.readFile(
    new URL("../src/organization/templates/bidding-v1.yaml", import.meta.url),
    "utf8",
  );
}

describe("bidding template bundle", () => {
  it("stays identical to the YAML source (the server ships bundled, no file reads)", async () => {
    expect(BIDDING_V1_YAML).toBe(await biddingTemplate());
  });
});

describe("parseWorkflowDefinition", () => {
  it("parses the bundled bidding template with seven stages", async () => {
    const raw = await biddingTemplate();
    const parsed = parseWorkflowDefinition(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.id).toBe("bidding-v1");
    expect(parsed.value.version).toBe(1);
    expect(parsed.value.stages.map((s) => s.key)).toEqual([
      "capture",
      "terms",
      "analysis",
      "response",
      "demo",
      "qa",
      "delivery",
    ]);
    const demo = parsed.value.stages.find((s) => s.key === "demo");
    expect(demo?.skipWhen).toBe("no-demo");
    expect(demo?.parallelWith).toEqual(["response"]);
  });

  it("round-trips through its serializer", async () => {
    const raw = await biddingTemplate();
    const parsed = parseWorkflowDefinition(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = parseWorkflowDefinition(serializeWorkflowDefinition(parsed.value));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value.stages.map((s) => s.key)).toEqual(
      parsed.value.stages.map((s) => s.key),
    );
  });

  it("rejects duplicate stage keys and dangling parallel targets", () => {
    const dup = parseWorkflowDefinition(
      "id: w\nversion: 1\nname: W\nstages:\n  - {key: alpha, name: A, ownerRole: R}\n  - {key: alpha, name: B, ownerRole: R}\n",
    );
    expect(dup.ok).toBe(false);
    const dangling = parseWorkflowDefinition(
      "id: w\nversion: 1\nname: W\nstages:\n  - {key: a, name: A, ownerRole: R, parallelWith: [ghost]}\n",
    );
    expect(dangling.ok).toBe(false);
  });

  it("rejects empty stages and bad versions", () => {
    expect(parseWorkflowDefinition("id: w\nversion: 0\nname: W\nstages: []\n").ok).toBe(false);
    expect(parseWorkflowDefinition("not: yaml: mapping").ok).toBe(false);
  });
});

describe("snapshot replay", () => {
  it("advances, rejects and attaches in order", async () => {
    const raw = await biddingTemplate();
    const parsed = parseWorkflowDefinition(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const def = parsed.value;
    const stages = def.stages.map((s) => s.key);
    const base = initialSnapshot("2026-11-01-x", def, "term-1", "T", "alice", "2026-11-01T00:00:00Z");
    expect(base.currentStage).toBe("capture");
    expect(base.stepStates["capture"]).toBe("active");
    const advanced = replayEvents(base, stages, [
      { kind: "advanced", at: "2026-11-01T01:00:00Z", by: "alice", from: "capture", to: "terms" },
    ]);
    expect(advanced.currentStage).toBe("terms");
    expect(advanced.stepStates["capture"]).toBe("done");
    const rejected = replayEvents(advanced, stages, [
      { kind: "rejected", at: "2026-11-01T02:00:00Z", by: "qa", from: "terms", to: "capture", reason: "缺截止时间" },
    ]);
    expect(rejected.currentStage).toBe("capture");
    expect(rejected.stepStates["terms"]).toBe("pending");
    const attached = replayEvents(rejected, stages, [
      { kind: "attached", at: "2026-11-01T03:00:00Z", by: "alice", ticketId: "2026-11-01-resp-x" },
    ]);
    expect(attached.attachments).toEqual(["2026-11-01-resp-x"]);
  });
});
