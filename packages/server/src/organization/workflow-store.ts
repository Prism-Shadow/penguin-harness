/**
 * File I/O for organization workflows: definitions (`workflows/<wfId>/definition.yaml`)
 * and instances (`instances/<instId>/{state.jsonl,snapshot.json}`). Same style as
 * OrgStore — whole-file replacements, missing files reported as null, snapshots derived
 * from the append-only event stream and rebuildable at any time.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile } from "@prismshadow/penguin-core";
import type { ParseResult } from "./files.js";
import {
  initialSnapshot,
  parseWorkflowDefinition,
  replayEvents,
  type WorkflowDefinition,
  type WorkflowInstanceEvent,
  type WorkflowInstanceSnapshot,
} from "./workflow-files.js";
import {
  isWorkflowInstanceId,
  workflowDefinitionPath,
  workflowInstanceEventsPath,
  workflowInstanceSnapshotPath,
  workflowInstancesDir,
  workflowsDir,
} from "./workflow-paths.js";

export interface WorkflowDefinitionFile {
  wfId: string;
  raw: string;
  parsed: ParseResult<WorkflowDefinition>;
  mtimeMs: number;
}

export interface WorkflowInstanceFile {
  instanceId: string;
  snapshot: WorkflowInstanceSnapshot;
  events: WorkflowInstanceEvent[];
  snapshotStale: boolean;
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

function parseEventLine(line: string): WorkflowInstanceEvent | null {
  try {
    const v = JSON.parse(line) as Partial<WorkflowInstanceEvent>;
    if (!v || typeof v.kind !== "string" || typeof v.at !== "string" || typeof v.by !== "string")
      return null;
    if (!["created", "advanced", "rejected", "attached", "note"].includes(v.kind)) return null;
    return v as WorkflowInstanceEvent;
  } catch {
    return null;
  }
}

export class WorkflowStore {
  /** Every definition directory carrying a `definition.yaml`, by id. */
  async listDefinitions(dir: string): Promise<WorkflowDefinitionFile[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(workflowsDir(dir), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: WorkflowDefinitionFile[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name.startsWith("_")) continue;
      const p = workflowDefinitionPath(dir, e.name);
      const raw = await readText(p);
      if (raw === null) continue;
      const stat = await fs.stat(p);
      out.push({ wfId: e.name, raw, parsed: parseWorkflowDefinition(raw), mtimeMs: stat.mtimeMs });
    }
    return out.sort((a, b) => a.wfId.localeCompare(b.wfId));
  }

  async readDefinition(dir: string, wfId: string): Promise<WorkflowDefinitionFile | null> {
    const p = workflowDefinitionPath(dir, wfId);
    const raw = await readText(p);
    if (raw === null) return null;
    const stat = await fs.stat(p);
    return { wfId, raw, parsed: parseWorkflowDefinition(raw), mtimeMs: stat.mtimeMs };
  }

  async writeDefinition(dir: string, wfId: string, def: WorkflowDefinition): Promise<void> {
    const { serializeWorkflowDefinition } = await import("./workflow-files.js");
    const p = workflowDefinitionPath(dir, wfId);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await atomicWriteFile(p, serializeWorkflowDefinition(def));
  }

  /** Every instance directory carrying a `state.jsonl`, newest first by id. */
  async listInstances(dir: string): Promise<WorkflowInstanceFile[]> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(workflowInstancesDir(dir), { withFileTypes: true });
    } catch {
      return [];
    }
    const out: WorkflowInstanceFile[] = [];
    for (const e of entries) {
      if (!e.isDirectory() || !isWorkflowInstanceId(e.name)) continue;
      const inst = await this.readInstance(dir, e.name);
      if (inst !== null) out.push(inst);
    }
    return out.sort((a, b) => b.instanceId.localeCompare(a.instanceId));
  }

  async readInstance(dir: string, instanceId: string): Promise<WorkflowInstanceFile | null> {
    const eventsPath = workflowInstanceEventsPath(dir, instanceId);
    const raw = await readText(eventsPath);
    if (raw === null) return null;
    const events: WorkflowInstanceEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.trim() === "") continue;
      const e = parseEventLine(line);
      if (e !== null) events.push(e);
    }
    const created = events.find((e) => e.kind === "created");
    if (!created) return null;
    // Rebuild the snapshot from the definition when available, else from the stored one.
    const storedSnap = await readText(workflowInstanceSnapshotPath(dir, instanceId));
    let stored: WorkflowInstanceSnapshot | null = null;
    if (storedSnap !== null) {
      try {
        stored = JSON.parse(storedSnap) as WorkflowInstanceSnapshot;
      } catch {
        stored = null;
      }
    }
    const def = await this.readDefinition(dir, created.text ?? "");
    let snapshot: WorkflowInstanceSnapshot;
    let stale = false;
    if (def?.parsed.ok && stored) {
      const defValue = def.parsed.value;
      const stages = defValue.stages.map((s) => s.key);
      const base = initialSnapshot(
        instanceId,
        defValue,
        stored.bizKey,
        stored.title,
        created.by,
        created.at,
      );
      // Replay every event after `created` onto a clean base from the definition.
      // The definitionVersion stays the instance's own: a rebuilt snapshot must not
      // silently re-base an old instance onto a newer definition (that is what
      // `versionMismatch` reports, and re-basing is a human decision).
      const replayed = replayEvents(
        base,
        stages,
        events.filter((e) => e.kind !== "created"),
      );
      snapshot = { ...replayed, definitionVersion: stored.definitionVersion };
      stale =
        snapshot.currentStage !== stored.currentStage ||
        JSON.stringify(snapshot.stepStates) !== JSON.stringify(stored.stepStates) ||
        JSON.stringify(snapshot.attachments) !== JSON.stringify(stored.attachments);
    } else if (stored) {
      snapshot = stored;
    } else {
      return null;
    }
    return { instanceId, snapshot, events, snapshotStale: stale };
  }

  async createInstance(
    dir: string,
    instanceId: string,
    def: WorkflowDefinition,
    bizKey: string,
    title: string,
    by: string,
    at: string,
  ): Promise<WorkflowInstanceSnapshot> {
    const snap = initialSnapshot(instanceId, def, bizKey, title, by, at);
    const created: WorkflowInstanceEvent = {
      kind: "created",
      at,
      by,
      text: def.id,
      reason: `v${def.version}`,
    };
    await fs.mkdir(path.dirname(workflowInstanceEventsPath(dir, instanceId)), { recursive: true });
    await atomicWriteFile(workflowInstanceEventsPath(dir, instanceId), `${JSON.stringify(created)}\n`);
    await atomicWriteFile(workflowInstanceSnapshotPath(dir, instanceId), `${JSON.stringify(snap, null, 2)}\n`);
    return snap;
  }

  async appendEvent(
    dir: string,
    instanceId: string,
    event: WorkflowInstanceEvent,
    snapshot: WorkflowInstanceSnapshot,
  ): Promise<void> {
    await fs.appendFile(workflowInstanceEventsPath(dir, instanceId), `${JSON.stringify(event)}\n`, "utf8");
    await atomicWriteFile(
      workflowInstanceSnapshotPath(dir, instanceId),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
  }
}
