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

/** Vault file name inside a snapshot/import package (used for archive filtering). */
const VAULT_BASENAME = ".vault.toml";

function isVaultEntry(entryPath: string): boolean {
  return path.posix.basename(entryPath.replaceAll("\\", "/")) === VAULT_BASENAME;
}

export class SnapshotService {
  constructor(private readonly root: string) {}

  /** Current Agent State version number (missing field treated as 1); throws 404 if the Agent doesn't exist. */
  async currentVersion(projectId: string, agentId: string): Promise<number> {
    let raw: string;
    try {
      raw = await fs.readFile(systemConfigPath(this.root, projectId, agentId), "utf8");
    } catch {
      throw new HttpError(404, "agent_not_found", "Agent 不存在。");
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
   */
  async importArchive(
    projectId: string,
    agentId: string,
    archive: Buffer,
    confirm: boolean,
  ): Promise<{ version: number }> {
    const current = await this.currentVersion(projectId, agentId);
    const base = agentDir(this.root, projectId, agentId);
    const staging = path.join(base, `.import-${randomBytes(6).toString("hex")}`);
    await fs.mkdir(staging, { recursive: true });
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
        throw badRequest("导入失败：不是合法的 tar.gz 快照包。");
      }

      // Validation: the package must contain agent_state/system_config.yaml, and version must be valid.
      const configPath = path.join(extractDir, "agent_state", "system_config.yaml");
      let parsed: unknown;
      try {
        parsed = parseYaml(await fs.readFile(configPath, "utf8"));
      } catch {
        throw badRequest("导入失败：包内缺少 agent_state/system_config.yaml。");
      }
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        typeof (parsed as { system_prompt?: unknown }).system_prompt !== "string"
      ) {
        throw badRequest("导入失败：包内 system_config.yaml 非法。");
      }
      const incomingRaw = (parsed as { version?: unknown }).version;
      if (
        incomingRaw !== undefined &&
        (!Number.isInteger(incomingRaw) || (incomingRaw as number) < 1)
      ) {
        throw badRequest("导入失败：包内 version 非法。");
      }
      const incoming = agentStateVersion({
        version: typeof incomingRaw === "number" ? incomingRaw : undefined,
      });
      if (incoming <= current && !confirm) {
        throw new HttpError(
          409,
          "version_conflict",
          `包版本 v${incoming} 不高于当前 v${current}，需要确认后导入。`,
        );
      }

      // Automatically snapshots the current version before import (reused if one already exists for that version), so a mistaken import can be rolled back.
      await this.ensureSnapshot(projectId, agentId);

      // Replace agent_state: first merge the current vault into the staging
      // directory to be swapped in (extraction already filtered out any vault
      // inside the package, so no conflict), making the replacement a pure rename
      // swap — once the swap lands, there's no further write that can fail. The
      // vault never goes into a snapshot, so if recovery fails after the swap, the
      // `finally` cleanup of staging would delete the only vault copy with no way
      // to roll back.
      const stateDir = agentStateDir(this.root, projectId, agentId);
      const incomingState = path.join(extractDir, "agent_state");
      let vault: Buffer | null = null;
      try {
        vault = await fs.readFile(agentVaultPath(this.root, projectId, agentId));
      } catch {
        // No vault means nothing to preserve.
      }
      if (vault !== null) {
        await fs.writeFile(path.join(incomingState, VAULT_BASENAME), vault, { mode: 0o600 });
      }
      const trash = path.join(staging, "replaced-agent_state");
      await fs.rename(stateDir, trash);
      try {
        await fs.rename(incomingState, stateDir);
      } catch (err) {
        await fs.rename(trash, stateDir); // Rollback: restore the old directory if swapping in the new one fails.
        throw err;
      }
      return { version: incoming };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  }
}
