/**
 * What of an Agent State travels in a package, and the checks a package's `agent_state/` passes
 * before it can become an Agent's. Shared by the version snapshots (snapshot-service.ts), the
 * Agent archive's zip export and import (../agent-archive/) and its `.tar.gz` compatibility path.
 *
 * Never travelling: the vault (`.vault.toml`; secrets never go into a package), the server's
 * staging leftovers (`*.penguin-tmp*`), each workbench's emitted code and installed packages
 * (`.build/`, `node_modules/`), and any path with a segment git treats as `.git` (a planted
 * repository's config runs code when git is run there).
 */
import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { agentStateVersion } from "@prismshadow/penguin-core";
import { badRequest } from "../http/errors.js";
import { isGitName } from "../workbenches/repo.js";
import { isTempName } from "../workbenches/store.js";

/** The vault's file name inside `agent_state/`. */
export const VAULT_BASENAME = ".vault.toml";

/**
 * An archive path's segments as extraction places them: separators unified, a drive prefix
 * (`C:`, which tar strips only after filtering) and `.` segments dropped.
 */
export function segmentsOf(entryPath: string): string[] {
  return entryPath
    .replaceAll("\\", "/")
    .replace(/^[A-Za-z]:/, "")
    .split("/")
    .filter((s) => s !== "" && s !== ".");
}

/**
 * What a snapshot leaves out and an import never takes from a package: any vault, the server's
 * staging leftovers (`*.penguin-tmp*`), and each workbench's emitted code and installed packages.
 * `entryPath` is rooted at the Agent directory (`agent_state/…`).
 */
export function isLeftOut(entryPath: string): boolean {
  const segments = segmentsOf(entryPath);
  if (segments.at(-1) === VAULT_BASENAME || segments.some(isTempName)) return true;
  const [top, child, ...rest] = segments;
  // Anywhere inside `agent_state/workbenches/<id>/`.
  return (
    top === "agent_state" &&
    child === "workbenches" &&
    rest.slice(1).some((s) => s === ".build" || s === "node_modules")
  );
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
export async function assertLinksStayInside(stateDir: string): Promise<void> {
  let top: Stats;
  try {
    top = await fs.lstat(stateDir);
  } catch {
    return; // No agent_state at all: the config read reports the missing file.
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

/**
 * The version of a package's `agent_state/`, read from its `system_config.yaml`, which must be
 * there, parse, carry a `system_prompt`, and hold a valid `version` when it holds one (a missing
 * one reads as 1, as everywhere).
 */
export async function packageStateVersion(stateDir: string): Promise<number> {
  let parsed: unknown;
  try {
    parsed = parseYaml(await fs.readFile(path.join(stateDir, "system_config.yaml"), "utf8"));
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
  const raw = (parsed as { version?: unknown }).version;
  if (raw !== undefined && (!Number.isInteger(raw) || (raw as number) < 1)) {
    throw badRequest("Import failed: the package's version is invalid.");
  }
  return agentStateVersion({ version: typeof raw === "number" ? raw : undefined });
}
