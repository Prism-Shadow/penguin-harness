/**
 * Agent State import, and the snapshot an overwrite takes first.
 *
 * A package is a zip of the Agent's directory (./agent-zip.ts) or a `.tar.gz` snapshot exported
 * before, rooted at `agent_state/`; only the unpack differs. Import goes by the `version` inside
 * the package and keeps the current vault; before an overwrite, the current State is packed
 * afresh into `snapshots/import-backup-v<version>-<time>-<random>.tar.gz`, **excluding
 * `.vault.toml`** (secrets never go into a snapshot), the server's staging leftovers
 * (`*.penguin-tmp*`) and each workbench's emitted code and installed packages (`.build/`,
 * `node_modules/`), named outside the `v<N>.tar.gz` pattern the optimizer Skills read versions
 * from. A package's `agent_state/` must be a real directory whose links all resolve inside it,
 * and no entry with a `.git` path segment is extracted (a planted repository's config runs code
 * when git is run there); the current vault must be readable (a missing one is simply absent).
 * A `system_config.yaml` without `system_prompt` is laid over the template's (./partial-config.ts).
 * Docs: /docs/self-improvement § "Snapshots and versions".
 */
import { randomBytes } from "node:crypto";
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
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
import type { Clock, Log, Paths } from "../hmr/capabilities.js";
import type { AgentPackage, Snapshots } from "../mechanisms/agents.js";
import { isGitName } from "../workbenches/repo.js";
import { isTempName, STATE_FILE } from "../workbenches/store.js";
import { isZip, unpackAgentZip } from "./agent-zip.js";
import { overTemplate } from "./partial-config.js";

/** Vault file name inside a snapshot/import package (used for archive filtering). */
const VAULT_BASENAME = ".vault.toml";

/**
 * An archive path's segments as extraction places them: separators unified, a drive prefix
 * (`C:`, which tar strips only after filtering) and `.` segments dropped.
 */
function segmentsOf(entryPath: string): string[] {
  return entryPath
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
}

/**
 * What a snapshot or an export leaves out and an import never takes from a package: any vault, in
 * any letter case, the server's staging leftovers (`*.penguin-tmp*`), and each workbench's
 * emitted code and installed packages. Paths are rooted at `agent_state/`.
 */
export function isLeftOut(entryPath: string): boolean {
  const segments = segmentsOf(entryPath);
  if (segments.at(-1)?.toLowerCase() === VAULT_BASENAME || segments.some(isTempName)) return true;
  const [top, child, ...rest] = segments;
  // Anywhere inside `agent_state/workbenches/<id>/`.
  return (
    top === "agent_state" &&
    child === "workbenches" &&
    rest.slice(1).some((s) => s === ".build" || s === "node_modules")
  );
}

/** The State folders an export may leave out (see agent-export.ts). */
const PART_FOLDERS = ["skills", "hooks", "memory", "workbenches", "schedule"];

/**
 * An overwrite replaces the parts a package carries, not the ones it left out: a part folder the
 * package has none of (an export without memory, say) is copied over from the current State, as is
 * a workbench's data the package left out. The backup holds everything the swap replaces.
 */
async function keepAbsentParts(current: string, incoming: string): Promise<void> {
  const exists = (p: string) =>
    fs.lstat(p).then(
      () => true,
      () => false,
    );
  for (const part of PART_FOLDERS) {
    const from = path.join(current, part);
    const to = path.join(incoming, part);
    if (!(await exists(to)) && (await exists(from))) {
      await fs.cp(from, to, { recursive: true, verbatimSymlinks: true });
    }
  }
  const workbenches = path.join(incoming, "workbenches");
  for (const id of await fs.readdir(workbenches).catch((): string[] => [])) {
    const from = path.join(current, "workbenches", id, STATE_FILE);
    const to = path.join(workbenches, id, STATE_FILE);
    if (!(await exists(to)) && (await exists(from))) await fs.copyFile(from, to);
  }
}

/** An entry inside a git directory, under any spelling git itself treats as `.git`. */
export function isGitEntry(entryPath: string): boolean {
  return segmentsOf(entryPath).some(isGitName);
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
   * one already there. Answers its file name.
   */
  private async backupBeforeImport(projectId: string, agentId: string): Promise<string> {
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
    return name;
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
   * Import: validates the package structure and `version`, packs a fresh backup of the current
   * State, then replaces `agent_state/` while keeping the current vault, and hands the package's
   * `traces/` to `pkg.landTraces`.
   *
   * `preSnapshot: false` skips the pre-import backup — for seeding a freshly created Agent,
   * whose template state is not worth preserving.
   */
  async importArchive(
    projectId: string,
    agentId: string,
    pkg: AgentPackage,
    opts: { preSnapshot: boolean },
  ): Promise<{ version: number; backup?: string }> {
    await this.currentVersion(projectId, agentId); // 404 for an Agent that is not there
    const base = agentDir(this.root, projectId, agentId);
    const staging = path.join(base, `.import-${randomBytes(6).toString("hex")}`);
    await fs.mkdir(staging, { recursive: true });
    // Set when staging holds the only copy of the previous State (swap and rollback both failed).
    let keepStaging = false;
    try {
      const extractDir = path.join(staging, "extracted");
      await fs.mkdir(extractDir, { recursive: true });
      if (isZip(pkg.bytes)) {
        await unpackAgentZip(pkg.bytes, extractDir, (p) => !isLeftOut(p) && !isGitEntry(p));
      } else {
        const archiveFile = path.join(staging, "archive.tar.gz");
        await fs.writeFile(archiveFile, pkg.bytes);
        try {
          await tar.extract({
            file: archiveFile,
            cwd: extractDir,
            filter: (p) => !isLeftOut(p) && !isGitEntry(p),
          });
        } catch {
          throw badRequest("Import failed: not a zip or a tar.gz snapshot package.");
        }
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
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw badRequest("Import failed: the package's system_config.yaml is invalid.");
      }
      if (typeof (parsed as { system_prompt?: unknown }).system_prompt !== "string") {
        parsed = overTemplate(parsed as Record<string, unknown>);
        await fs.writeFile(configPath, stringifyYaml(parsed));
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

      // A mistaken import can be rolled back from this backup: always a new one, since a
      // same-version snapshot may be older than what is about to be replaced.
      const backup = opts.preSnapshot ? await this.backupBeforeImport(projectId, agentId) : null;

      // Replace agent_state: merge the current vault into the directory to be swapped in
      // (extraction filtered any vault inside the package), so the replacement is a pure
      // rename swap. The vault never goes into a snapshot: only a *missing* vault means there
      // is nothing to keep — any other read failure stops the import, because the swap would
      // otherwise discard the only copy.
      const stateDir = agentStateDir(this.root, projectId, agentId);
      if (opts.preSnapshot) await keepAbsentParts(stateDir, incomingState);
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
      await pkg.landTraces?.(path.join(extractDir, "traces"));
      return { version: incoming, ...(backup !== null ? { backup } : {}) };
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
