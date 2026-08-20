/**
 * Where an installed workflow lives: the agent's own folder.
 *
 * A workflow is not part of the platform bundle. It is installed per agent, over HTTP,
 * and outlives every push — so it is stored beside the agent's other state rather than
 * in the hmr artifact store, and each App creation reads whatever is on disk at that
 * moment (see ./registry.ts). That is what makes installing one take effect without a
 * push, and a push take effect without reinstalling one.
 *
 * Layout, under `agentStateDir(root, projectId, agentId)`:
 *
 *     workflows/<workflowId>/workflow.js     the script
 *     workflows/<workflowId>/ui/<path>       optional per-workflow UI files
 *
 * `workflowId` is a single path segment, validated on the way in: it becomes a directory
 * name and a URL segment, and neither may be steered by the caller.
 */
import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import type { Json } from "@prismshadow/penguin-core/kernel";
import { agentStateDir } from "@prismshadow/penguin-core";

export const SCRIPT_FILE = "workflow.js";
const STATE_FILE = "state.json";
const WORKFLOWS_DIR = "workflows";
const UI_DIR = "ui";

/**
 * A type alias, not an interface: this shape is parked in the platform document
 * (hmr/platform.ts's PlatformCtx), and only an alias carries the implicit index
 * signature that makes it assignable to the kernel's `Json`.
 */
export type WorkflowRef = {
  projectId: string;
  agentId: string;
  workflowId: string;
};

export interface StoredWorkflow extends WorkflowRef {
  /** `<agentId>/<workflowId>` — stable across reads, and what the HTTP surface names. */
  id: string;
  script: string;
  /** Content hash of the UI tree; null when the workflow ships no UI. */
  uiRev: string | null;
}

export class WorkflowIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowIdError";
  }
}

/**
 * One path segment, no traversal, no separators. Rejecting rather than sanitizing keeps
 * the id the caller sees identical to the directory that holds it.
 */
export function assertSegment(label: string, value: string): void {
  if (value === "" || value === "." || value === "..") {
    throw new WorkflowIdError(`${label} must not be empty, '.' or '..'`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new WorkflowIdError(
      `${label} must be alphanumeric with '.', '_' or '-' after the first character`,
    );
  }
}

export class WorkflowStore {
  constructor(private readonly root: string) {}

  private dir(ref: WorkflowRef): string {
    assertSegment("projectId", ref.projectId);
    assertSegment("agentId", ref.agentId);
    assertSegment("workflowId", ref.workflowId);
    return path.join(
      agentStateDir(this.root, ref.projectId, ref.agentId),
      WORKFLOWS_DIR,
      ref.workflowId,
    );
  }

  async install(ref: WorkflowRef, script: string, ui?: Record<string, string>): Promise<void> {
    const dir = this.dir(ref);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, SCRIPT_FILE), script, "utf8");
    const uiDir = path.join(dir, UI_DIR);
    if (ui === undefined) {
      await fsp.rm(uiDir, { recursive: true, force: true });
      return;
    }
    // A UI is served as a page, so it needs an entry; and the tree is built beside the
    // live one and renamed over it, so a failed write never leaves a half-replaced UI.
    if (typeof ui["index.html"] !== "string") {
      throw new WorkflowIdError("workflow UI has no index.html");
    }
    const tmp = `${uiDir}.${process.pid}.tmp`;
    await fsp.rm(tmp, { recursive: true, force: true });
    for (const [rel, base64] of Object.entries(ui)) {
      const target = path.resolve(tmp, rel);
      // Installing must not become a write primitive for the rest of the disk.
      if (!target.startsWith(path.resolve(tmp) + path.sep)) {
        throw new WorkflowIdError(`ui file '${rel}' escapes the workflow directory`);
      }
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, Buffer.from(base64, "base64"));
    }
    await fsp.rm(uiDir, { recursive: true, force: true });
    await fsp.rename(tmp, uiDir);
  }

  /** The state the previous instance parked, or null when there is none to resume from. */
  async readState(ref: WorkflowRef): Promise<Json> {
    try {
      return JSON.parse(await fsp.readFile(path.join(this.dir(ref), STATE_FILE), "utf8")) as Json;
    } catch {
      return null;
    }
  }

  /**
   * Writes down what a workflow parked. Atomic (write beside, rename over) so a crash
   * mid-write leaves the previous state rather than a truncated file.
   */
  async writeState(ref: WorkflowRef, state: Json): Promise<void> {
    const file = path.join(this.dir(ref), STATE_FILE);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2));
    await fsp.rename(tmp, file);
  }

  async remove(ref: WorkflowRef): Promise<boolean> {
    const dir = this.dir(ref);
    try {
      await fsp.stat(dir);
    } catch {
      return false;
    }
    await fsp.rm(dir, { recursive: true, force: true });
    return true;
  }

  async read(ref: WorkflowRef): Promise<StoredWorkflow | null> {
    const dir = this.dir(ref);
    let script: string;
    try {
      script = await fsp.readFile(path.join(dir, SCRIPT_FILE), "utf8");
    } catch {
      return null;
    }
    return {
      ...ref,
      id: `${ref.agentId}/${ref.workflowId}`,
      script,
      uiRev: await uiRevision(path.join(dir, UI_DIR)),
    };
  }

  /** Every workflow installed for one agent. A missing folder reads as none. */
  async list(projectId: string, agentId: string): Promise<StoredWorkflow[]> {
    assertSegment("projectId", projectId);
    assertSegment("agentId", agentId);
    const base = path.join(agentStateDir(this.root, projectId, agentId), WORKFLOWS_DIR);
    let names: string[];
    try {
      names = (await fsp.readdir(base, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    const out: StoredWorkflow[] = [];
    for (const workflowId of names.sort()) {
      const stored = await this.read({ projectId, agentId, workflowId });
      if (stored !== null) out.push(stored);
    }
    return out;
  }

  /** One UI file's bytes, or null. The path is resolved inside the workflow's ui/ dir. */
  async uiFile(ref: WorkflowRef, rel: string): Promise<Buffer | null> {
    const uiDir = path.join(this.dir(ref), UI_DIR);
    const target = path.resolve(uiDir, rel);
    if (target !== uiDir && !target.startsWith(uiDir + path.sep)) return null;
    try {
      return await fsp.readFile(target);
    } catch {
      return null;
    }
  }
}

/**
 * A content hash over the UI tree — what an open App compares to know its workflow's UI
 * changed under it. Null when there is no UI at all, which is a different answer from
 * "an empty one".
 */
export async function uiRevision(uiDir: string): Promise<string | null> {
  const hash = crypto.createHash("sha256");
  let any = false;
  const walk = async (dir: string, rel: string): Promise<void> => {
    let entries: Array<{ name: string; isDirectory(): boolean }>;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.join(dir, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(child, childRel);
        continue;
      }
      any = true;
      hash.update(childRel);
      hash.update(await fsp.readFile(child));
    }
  };
  await walk(uiDir, "");
  return any ? hash.digest("hex").slice(0, 16) : null;
}
