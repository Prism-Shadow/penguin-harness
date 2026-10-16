/**
 * Agent State version snapshots and export/import.
 *
 * A snapshot = `snapshots/v<version>.tar.gz`, packaging `agent_state/` (archive
 * entries are rooted at `agent_state/`), **excluding `.vault.toml`** (secrets never
 * go into a snapshot); if a snapshot for the same version already exists, it isn't
 * repacked. Import goes by the `version` inside the package and keeps the current
 * vault; a snapshot of the current version is automatically taken before import;
 * importing a package version equal to or lower than the current version requires
 * explicit confirmation (otherwise 409).
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
import { badRequest } from "../http/validate.js";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Paths } from "../hmr/capabilities.js";
import type { Snapshots } from "../mechanisms/agents.js";

/** Vault file name inside a snapshot/import package (used for archive filtering). */
const VAULT_BASENAME = ".vault.toml";
const TRANSFERS_RESOURCE_ID = "platform.agentStateTransfers";

function isVaultEntry(entryPath: string): boolean {
  return path.posix.basename(entryPath.replaceAll("\\", "/")) === VAULT_BASENAME;
}

@Component()
export class SnapshotService implements Snapshots {
  @Use() private readonly paths!: Paths;
  private transfers = new Map<string, Promise<void>>();
  private get root(): string {
    return this.paths.root;
  }

  setup({ resources }: ClassCtx) {
    // In-flight HTTP transfers outlive the platform generation that accepted them.
    this.transfers = resources.claim(TRANSFERS_RESOURCE_ID) ?? this.transfers;
    resources.register(TRANSFERS_RESOURCE_ID, this.transfers);
  }

  private async withTransfer<T>(
    projectId: string,
    agentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let key: string;
    try {
      key = await fs.realpath(agentDir(this.root, projectId, agentId));
    } catch {
      throw new HttpError(404, "agent_not_found", "Agent does not exist.");
    }
    const next = (this.transfers.get(key) ?? Promise.resolve()).then(operation);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.transfers.set(key, settled);
    try {
      return await next;
    } finally {
      if (this.transfers.get(key) === settled) this.transfers.delete(key);
    }
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
    return this.withTransfer(projectId, agentId, () => this.packSnapshot(projectId, agentId));
  }

  /** Called while this Agent's transfer owns the state directory. */
  private async packSnapshot(
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
    } finally {
      await fs.rm(tmp, { force: true });
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
    return this.withTransfer(projectId, agentId, () =>
      this.replaceFromArchive(projectId, agentId, archive, opts),
    );
  }

  private async replaceFromArchive(
    projectId: string,
    agentId: string,
    archive: Buffer,
    opts: { confirm: boolean; preSnapshot?: boolean },
  ): Promise<{ version: number }> {
    const current = await this.currentVersion(projectId, agentId);
    const base = agentDir(this.root, projectId, agentId);
    const staging = path.join(base, `.import-${randomBytes(6).toString("hex")}`);
    await fs.mkdir(staging, { recursive: true });
    let preserveStaging = false;
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
      if (opts.preSnapshot !== false) await this.packSnapshot(projectId, agentId);

      // Prepare the vault before swapping directories; snapshots exclude secrets,
      // so a failed rollback must retain the original state in staging.
      const stateDir = agentStateDir(this.root, projectId, agentId);
      const incomingState = path.join(extractDir, "agent_state");
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
          await fs.rename(trash, stateDir);
        } catch (restoreError) {
          preserveStaging = true;
          throw new AggregateError(
            [err, restoreError],
            `Import failed and the previous Agent State could not be restored. Recovery copy: ${trash}`,
          );
        }
        throw err;
      }
      return { version: incoming };
    } finally {
      if (!preserveStaging) await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
