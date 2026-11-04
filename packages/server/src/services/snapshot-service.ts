/**
 * Agent State version snapshots and export/import.
 *
 * A snapshot = `snapshots/v<version>.tar.gz`, packaging `agent_state/` (archive
 * entries are rooted at `agent_state/`), **excluding `.vault.toml`** (secrets never
 * go into a snapshot); if a snapshot for the same version already exists, it isn't
 * repacked. Import goes by the `version` inside the package and keeps the current
 * vault; a snapshot of the current version is automatically taken before import;
 * importing a package version equal to or lower than the current version requires
 * explicit confirmation (otherwise 409). A package's `agent_state/` must be a real
 * directory whose links all resolve inside it; the current vault must be readable (a
 * missing one is simply absent).
 * Docs: /docs/self-improvement § "Snapshots and versions".
 */
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
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
import { badRequest } from "../http/validate.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Log, Paths } from "../hmr/capabilities.js";
import type { Snapshots } from "../mechanisms/agents.js";

/** Vault file name inside a snapshot/import package (used for archive filtering). */
const VAULT_BASENAME = ".vault.toml";

function isVaultEntry(entryPath: string): boolean {
  return path.posix.basename(entryPath.replaceAll("\\", "/")) === VAULT_BASENAME;
}

/** `target` is `base` itself or lies below it (both already resolved by `realpath`). */
function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

/**
 * The package's `agent_state/` must be a real directory whose symbolic links all resolve
 * inside it. The directory is moved out of the staging area whole, so a link that leaves it
 * (into a sibling the package also carried, or anywhere else) would dangle or point at files
 * that are not this Agent's. `realpath` lets the filesystem resolve chains and `..` in
 * filesystem order, which no lexical check gets right; a link whose target is missing is
 * refused for the same reason. tar itself already confines entry paths and hard links to the
 * extraction directory, and a hard link keeps its content once staging is removed.
 */
async function assertLinksStayInside(stateDir: string): Promise<void> {
  let top: Stats;
  try {
    top = await fs.lstat(stateDir);
  } catch {
    return; // No agent_state at all: the config read below reports the missing file.
  }
  if (!top.isDirectory()) {
    throw badRequest("Import failed: the package's agent_state is not a real directory.");
  }
  const base = await fs.realpath(stateDir);
  const pending = [stateDir];
  for (let dir = pending.pop(); dir !== undefined; dir = pending.pop()) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        pending.push(full); // A Dirent is lstat-based: a linked directory is a link, not walked.
        continue;
      }
      if (!entry.isSymbolicLink()) continue;
      const target = await fs.realpath(full).catch(() => null);
      if (target === null || !isInside(base, target)) {
        const name = path.relative(stateDir, full).replaceAll("\\", "/");
        throw badRequest(
          `Import failed: the package's link agent_state/${name} leaves agent_state or points at nothing.`,
        );
      }
    }
  }
}

@Component()
export class SnapshotService implements Snapshots {
  @Use() private readonly paths!: Paths;
  @Use() private readonly log!: Log;
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

  /** Ensures a snapshot exists for the current version (not repacked for the same version), returns the snapshot file path and version number. */
  async ensureSnapshot(
    projectId: string,
    agentId: string,
  ): Promise<{ version: number; file: string }> {
    const version = await this.currentVersion(projectId, agentId);
    const dir = snapshotsDir(this.root, projectId, agentId);
    const file = path.join(dir, `v${version}.tar.gz`);
    try {
      await fs.access(file);
      return { version, file };
    } catch {
      // No snapshot for this version yet: pack it.
    }
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(4).toString("hex")}`;
    try {
      await tar.create(
        {
          gzip: true,
          cwd: agentDir(this.root, projectId, agentId),
          file: tmp,
          portable: true,
          filter: (p) => !isVaultEntry(p),
        },
        ["agent_state"],
      );
      await fs.rename(tmp, file);
    } catch (err) {
      // A half-written archive must not sit beside the real snapshots.
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
    return { version, file };
  }

  /** Export: automatically packs a snapshot first if none exists, returns the info needed for download. */
  async exportArchive(
    projectId: string,
    agentId: string,
  ): Promise<{ version: number; file: string; fileName: string }> {
    const { version, file } = await this.ensureSnapshot(projectId, agentId);
    return { version, file, fileName: `${agentId}-v${version}.tar.gz` };
  }

  /**
   * Import: validates the package structure and `version`, compares versions
   * (higher than current imports directly, same version or older requires
   * `confirm`), automatically snapshots the current version before import, then
   * replaces `agent_state/` while keeping the current vault.
   *
   * `preSnapshot: false` skips the automatic pre-import snapshot — for seeding a
   * freshly created Agent, whose template state is not worth preserving (its
   * caller passes `confirm: true` for the same reason: both guards protect
   * existing State, and a fresh Agent has none).
   */
  async importArchive(
    projectId: string,
    agentId: string,
    archive: Buffer,
    opts: { confirm: boolean; preSnapshot?: boolean },
  ): Promise<{ version: number }> {
    const current = await this.currentVersion(projectId, agentId);
    const base = agentDir(this.root, projectId, agentId);
    const staging = path.join(base, `.import-${randomBytes(6).toString("hex")}`);
    await fs.mkdir(staging, { recursive: true });
    // Set when staging holds the only copy of the previous State (swap and rollback both failed).
    let keepStaging = false;
    try {
      const archiveFile = path.join(staging, "archive.tar.gz");
      await fs.writeFile(archiveFile, archive);
      const extractDir = path.join(staging, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      try {
        await tar.extract({
          file: archiveFile,
          cwd: extractDir,
          filter: (p) => !isVaultEntry(p),
        });
      } catch {
        throw badRequest("Import failed: not a valid tar.gz snapshot package.");
      }

      const incomingState = path.join(extractDir, "agent_state");
      await assertLinksStayInside(incomingState);

      // Validation: the package must contain agent_state/system_config.yaml, and version must be valid.
      const configPath = path.join(extractDir, "agent_state", "system_config.yaml");
      let parsed: unknown;
      try {
        parsed = parseYaml(await fs.readFile(configPath, "utf8"));
      } catch {
        throw badRequest("Import failed: the package is missing agent_state/system_config.yaml.");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof (parsed as { system_prompt?: unknown }).system_prompt !== "string"
      ) {
        throw badRequest("Import failed: the package's system_config.yaml is invalid.");
      }
      const incomingRaw = (parsed as { version?: unknown }).version;
      if (
        incomingRaw !== undefined &&
        (!Number.isInteger(incomingRaw) || (incomingRaw as number) < 1)
      ) {
        throw badRequest("Import failed: the package's version is invalid.");
      }
      const incoming = agentStateVersion({
        version: typeof incomingRaw === "number" ? incomingRaw : undefined,
      });
      if (incoming <= current && !opts.confirm) {
        throw new HttpError(
          409,
          "version_conflict",
          `Package version v${incoming} is not higher than the current v${current}; confirmation is required to import.`,
        );
      }

      // Automatically snapshots the current version before import (reused if one already exists for that version), so a mistaken import can be rolled back.
      if (opts.preSnapshot !== false) await this.ensureSnapshot(projectId, agentId);

      // Replace agent_state: merge the current vault into the directory to be swapped in
      // (extraction filtered any vault inside the package), so the replacement is a pure
      // rename swap. The vault never goes into a snapshot: only a *missing* vault means there
      // is nothing to keep — any other read failure stops the import, because the swap would
      // otherwise discard the only copy.
      const stateDir = agentStateDir(this.root, projectId, agentId);
      let vault: Buffer | null = null;
      try {
        vault = await fs.readFile(agentVaultPath(this.root, projectId, agentId));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (vault !== null) {
        await fs.writeFile(path.join(incomingState, VAULT_BASENAME), vault, { mode: 0o600 });
      }
      const trash = path.join(staging, "replaced-agent_state");
      await fs.rename(stateDir, trash);
      try {
        await fs.rename(incomingState, stateDir);
      } catch (err) {
        try {
          await fs.rename(trash, stateDir); // Rollback: restore the old directory if swapping in the new one fails.
        } catch (rollbackErr) {
          keepStaging = true;
          throw new AggregateError(
            [err, rollbackErr],
            `Import failed and the previous Agent State could not be restored; it is kept at ${trash} — move it back to ${stateDir}.`,
          );
        }
        throw err;
      }
      return { version: incoming };
    } finally {
      // Once the swap has landed the import is committed: a cleanup failure is logged, not
      // reported as a failed import (which would also make the retry a 409).
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
