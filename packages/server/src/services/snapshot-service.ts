/**
 * Agent State version snapshots, and the replacement of an Agent's State by an imported one.
 *
 * A snapshot = a `.tar.gz` packaging `agent_state/` (archive entries are rooted at
 * `agent_state/`) without what never travels (agent-state-layout.ts: the vault, the server's
 * staging leftovers, each workbench's `.build/` and `node_modules/`). The version snapshots
 * `snapshots/v<N>.tar.gz` are the optimizer Skills' own; this service writes the backup an
 * import takes before it replaces a State: the current State packed afresh into a file of its
 * own, `snapshots/import-backup-v<version>-<time>-<random>.tar.gz` (a same-version snapshot can
 * predate the State's latest changes), named outside the `v<N>.tar.gz` pattern the Skills read
 * versions from.
 *
 * The replacement itself (`swapAgentState`, state-swap.ts) is one rename swap that keeps the
 * current vault and rolls back when the new State cannot be moved in, never removing anything of
 * the Agent's on a failure. What is swapped in was checked by the import
 * (../agent-archive/import.ts) before it gets here.
 * Docs: /docs/self-improvement § "Snapshots and versions".
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { parse as parseYaml } from "yaml";
import {
  agentDir,
  agentStateVersion,
  snapshotsDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import type { Snapshots } from "../mechanisms/agents.js";
import { isLeftOut } from "./agent-state-layout.js";
import { recoverStrandedSwaps, swapAgentState } from "./state-swap.js";

@Component()
export class SnapshotService implements Snapshots {
  @Use() private readonly paths!: Paths;
  @Use() private readonly log!: Log;
  @Use() private readonly clock!: Clock;
  private get root(): string {
    return this.paths.root;
  }

  /** Current Agent State version number (missing field treated as 1); throws 404 if the Agent doesn't exist. */
  async currentVersion(projectId: string, agentId: string): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(systemConfigPath(this.root, projectId, agentId), "utf8");
    } catch {
      throw new HttpError(404, "agent_not_found", "Agent does not exist.");
    }
    // A config that does not parse reads as version 1, so it can still be backed up and replaced.
    let parsed: { version?: unknown } | null = null;
    try {
      parsed = parseYaml(raw) as { version?: unknown } | null;
    } catch {
      parsed = null;
    }
    return agentStateVersion({
      version: typeof parsed?.version === "number" ? parsed.version : undefined,
    });
  }

  /**
   * The backup an import takes: the current State packed into a new file every time, never
   * one already there. Answers its path below the Agent directory (`snapshots/<name>`).
   */
  async backupBeforeImport(projectId: string, agentId: string): Promise<string> {
    const version = await this.currentVersion(projectId, agentId);
    const time = this.clock
      .now()
      .toISOString()
      .replace(/[-:]|\.\d+/g, "");
    const name = `import-backup-v${version}-${time}-${randomBytes(3).toString("hex")}.tar.gz`;
    await this.pack(
      projectId,
      agentId,
      path.join(snapshotsDir(this.root, projectId, agentId), name),
    );
    return `snapshots/${name}`;
  }

  /** Packs `agent_state/` into `file`, which appears only once it is complete. */
  private async pack(projectId: string, agentId: string, file: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
    try {
      await tar.create(
        {
          gzip: true,
          cwd: agentDir(this.root, projectId, agentId),
          file: tmp,
          portable: true,
          filter: (p) => !isLeftOut(p),
        },
        ["agent_state"],
      );
      await fs.rename(tmp, file);
    } catch (err) {
      // A half-written archive must not sit beside the real snapshots.
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }

  /** See state-swap.ts: one rename swap, kept entries carried, nothing of the Agent's ever removed on failure. */
  swapAgentState(
    projectId: string,
    agentId: string,
    incoming: string,
    carry: readonly string[] = [],
    backup: string | null = null,
  ): Promise<void> {
    return swapAgentState(
      this.root,
      (line) => this.log.line(line),
      projectId,
      agentId,
      incoming,
      carry,
      backup,
    );
  }

  /** Puts back what interrupted swaps left, for one Agent or every Agent (state-swap.ts). */
  recoverStrandedSwaps(scope?: { projectId: string; agentId: string }): Promise<void> {
    return recoverStrandedSwaps(this.root, (line) => this.log.line(line), scope);
  }
}
