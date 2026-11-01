/**
 * Workflow file I/O (src/organization/workflow-store.ts): definitions list and round-trip,
 * instances create/append/read with snapshot rebuild from the event stream.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseWorkflowDefinition } from "../src/organization/workflow-files.js";
import { WorkflowStore } from "../src/organization/workflow-store.js";

const tmpRoots: string[] = [];
afterEach(async () => {
  while (tmpRoots.length > 0) {
    const dir = tmpRoots.pop();
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
});

async function orgDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "wf-test-"));
  tmpRoots.push(dir);
  return dir;
}

const DEF_YAML = `id: bidding-v1
version: 1
name: 招投标交付流程
description: test
bizKeyPrefix: term-
stages:
  - key: capture
    name: 线索抓取
    ownerRole: 交付助理
    entries: []
    exits:
      - text: 要点表行已生成
  - key: terms
    name: 要点解析
    ownerRole: 标书分析师
    entries: []
    exits: []
`;

describe("WorkflowStore", () => {
  it("lists nothing on an empty org, then round-trips a definition", async () => {
    const dir = await orgDir();
    const wf = new WorkflowStore();
    expect(await wf.listDefinitions(dir)).toEqual([]);
    expect(await wf.listInstances(dir)).toEqual([]);
    const parsed = parseWorkflowDefinition(DEF_YAML);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await wf.writeDefinition(dir, "bidding-v1", parsed.value);
    const defs = await wf.listDefinitions(dir);
    expect(defs.map((d) => d.wfId)).toEqual(["bidding-v1"]);
    expect(defs[0]?.parsed.ok).toBe(true);
  });

  it("creates an instance and rebuilds its snapshot from the stream", async () => {
    const dir = await orgDir();
    const wf = new WorkflowStore();
    const parsed = parseWorkflowDefinition(DEF_YAML);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    await wf.writeDefinition(dir, "bidding-v1", parsed.value);
    const created = await wf.createInstance(
      dir,
      "2026-11-01-term-one",
      parsed.value,
      "term-1",
      "放疗项目",
      "alice",
      "2026-11-01T00:00:00Z",
    );
    expect(created.currentStage).toBe("capture");
    await wf.appendEvent(
      dir,
      "2026-11-01-term-one",
      { kind: "advanced", at: "2026-11-01T01:00:00Z", by: "alice", from: "capture", to: "terms" },
      {
        ...created,
        currentStage: "terms",
        stepStates: { capture: "done", terms: "active" },
        updatedAt: "2026-11-01T01:00:00Z",
        updatedBy: "alice",
      },
    );
    const read = await wf.readInstance(dir, "2026-11-01-term-one");
    expect(read?.snapshot.currentStage).toBe("terms");
    expect(read?.snapshotStale).toBe(false);
    expect(read?.events.map((e) => e.kind)).toEqual(["created", "advanced"]);
    // A hand-corrupted snapshot is detected against the stream, not trusted.
    await fs.writeFile(
      path.join(dir, "instances", "2026-11-01-term-one", "snapshot.json"),
      JSON.stringify({ ...created, currentStage: "capture" }),
    );
    const reread = await wf.readInstance(dir, "2026-11-01-term-one");
    expect(reread?.snapshot.currentStage).toBe("terms");
    expect(reread?.snapshotStale).toBe(true);
  });

  it("returns null for missing instances and skips stray directories", async () => {
    const dir = await orgDir();
    const wf = new WorkflowStore();
    expect(await wf.readInstance(dir, "2026-11-01-ghost")).toBeNull();
    await fs.mkdir(path.join(dir, "instances", "_templates"), { recursive: true });
    expect(await wf.listInstances(dir)).toEqual([]);
  });
});
