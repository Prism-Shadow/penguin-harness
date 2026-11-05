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
 * The replacement itself (`swapAgentState`) is one rename swap that keeps the current vault and
 * rolls back when the new State cannot be moved in. What is swapped in was checked and completed
 * by the import (../agent-archive/import.ts) before it gets here.
 * Docs: /docs/self-improvement § "Snapshots and versions".
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { parse as parseYaml } from "yaml";
import {
  agentDir,
  agentStateDir,
  agentStateVersion,
  agentVaultPath,
  snapshotsDir,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import type { Snapshots } from "../mechanisms/agents.js";
import { VAULT_BASENAME, isLeftOut } from "./agent-state-layout.js";

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
    const parsed = parseYaml(raw) as { version?: unknown } | null;
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

  /**
   * Replaces the Agent's `agent_state/` with `incoming` (a directory on the same filesystem,
   * checked by the caller), keeping the current vault and the current State's entries at the
   * `carry` paths (relative to `agent_state/`, `/`-separated): each replaces whatever `incoming`
   * holds there. Both move by rename, so keeping a large part costs nothing. The vault never
   * goes into a package: only a *missing* vault means there is nothing to keep — any other read
   * failure stops the swap, because it would otherwise discard the only copy. When the new State
   * cannot be moved in, the carried entries go back and the previous State is moved back; when
   * that fails too, it stays in a staging folder under the Agent directory and the error names
   * it.
   */
  async swapAgentState(
    projectId: string,
    agentId: string,
    incoming: string,
    carry: readonly string[] = [],
  ): Promise<void> {
    const base = agentDir(this.root, projectId, agentId);
    const staging = path.join(base, `.import-${randomBytes(6).toString("hex")}`);
    await fs.mkdir(staging, { recursive: true });
    // Set when staging holds the only copy of the previous State (swap and rollback both failed).
    let keepStaging = false;
    try {
      const stateDir = agentStateDir(this.root, projectId, agentId);
      let vault: Buffer | null = null;
      try {
        vault = await fs.readFile(agentVaultPath(this.root, projectId, agentId));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (vault !== null) {
        await fs.writeFile(path.join(incoming, VAULT_BASENAME), vault, { mode: 0o600 });
      }
      const trash = path.join(staging, "replaced-agent_state");
      await fs.rename(stateDir, trash);
      const carried: string[] = [];
      try {
        for (const rel of carry) {
          const from = path.join(trash, ...rel.split("/"));
          const to = path.join(incoming, ...rel.split("/"));
          await fs.rm(to, { recursive: true, force: true });
          await fs.mkdir(path.dirname(to), { recursive: true });
          await fs.rename(from, to);
          carried.push(rel);
        }
        await fs.rename(incoming, stateDir);
      } catch (err) {
        try {
          // Rollback: the carried entries go back, then the old directory is restored.
          for (const rel of carried.reverse()) {
            await fs.rename(
              path.join(incoming, ...rel.split("/")),
              path.join(trash, ...rel.split("/")),
            );
          }
          await fs.rename(trash, stateDir);
        } catch (rollbackErr) {
          keepStaging = true;
          throw new AggregateError(
            [err, rollbackErr],
            `Import failed and the previous Agent State could not be restored; it is kept at ${trash} — move it back to ${stateDir}.`,
          );
        }
        throw err;
      }
    } finally {
      // Once the swap has landed the import is committed: a cleanup failure is logged, not
      // reported as a failed import.
      if (!keepStaging) {
        await fs.rm(staging, { recursive: true, force: true }).catch((err: unknown) => {
          this.log.line(
            `[snapshots] import staging directory could not be removed: ${staging}: ${String(err)}`,
          );
        });
      }
    }
  }
}
