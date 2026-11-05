/**
 * Compatibility: `.tar.gz` Agent State packages written before the zip export. Remove with the
 * 1.0 release; whoever prepares 1.0 deletes this file and the `.tar.gz` entries in the pickers.
 *
 * Such a package is `agent_state/` as a tar.gz (what the settings page's old snapshot export
 * wrote). It is staged into the same layout as a zip, with a manifest made up for it: the parts
 * are what the package holds, it carries no Traces, and it names no Agent, so the import needs
 * an `agentId`. Extraction keeps the snapshot's own rules: nothing that never travels, no `.git`
 * path segment, nothing outside `agent_state/`, and links only when they resolve inside it.
 * The caps of the zip apply to what the headers declare, which for a tar is what it holds. The
 * internal version snapshots (`snapshots/v<N>.tar.gz`) and the import backups are not this
 * format's business and do not change.
 */
import fs from "node:fs/promises";
import path from "node:path";
import * as tar from "tar";
import { badRequest } from "../http/errors.js";
import {
  assertLinksStayInside,
  isGitEntry,
  isLeftOut,
  segmentsOf,
} from "../services/agent-state-layout.js";
import { MAX_ENTRIES, MAX_ENTRY_BYTES, MAX_INFLATED_BYTES, archiveTooLarge } from "./limits.js";
import { ARCHIVE_FORMAT, PART_DIRS } from "./manifest.js";
import type { StagedArchive } from "./staging.js";

const exists = (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

/** Extracts the package at `upload` into `extracted/` and makes up its manifest. */
export async function stageTarGz(
  upload: string,
  extracted: string,
  now: Date,
): Promise<StagedArchive> {
  let entries = 0;
  let total = 0;
  let overCap: string | null = null;
  try {
    await tar.extract({
      file: upload,
      cwd: extracted,
      filter: (entryPath, entry) => {
        const segments = segmentsOf(entryPath);
        if (segments[0] !== "agent_state" || isLeftOut(entryPath) || isGitEntry(entryPath)) {
          return false;
        }
        const size = "size" in entry && typeof entry.size === "number" ? entry.size : 0;
        entries += 1;
        total += size;
        if (entries > MAX_ENTRIES)
          overCap ??= `The package exceeds the ${MAX_ENTRIES}-entry limit.`;
        if (size > MAX_ENTRY_BYTES)
          overCap ??= `A package entry exceeds the 256MiB limit: ${entryPath}`;
        if (total > MAX_INFLATED_BYTES) overCap ??= "The package holds more than the 1GiB limit.";
        return overCap === null;
      },
    });
  } catch {
    throw badRequest("Import failed: not a valid tar.gz snapshot package.");
  }
  if (overCap !== null) throw archiveTooLarge(overCap);
  const stateDir = path.join(extracted, "agent_state");
  await assertLinksStayInside(stateDir);
  const holds = (dir: string): Promise<boolean> => exists(path.join(stateDir, dir));
  const workbenchData = await fs
    .readdir(path.join(stateDir, PART_DIRS.workbenches))
    .then(async (ids) => {
      for (const id of ids) {
        if (await exists(path.join(stateDir, PART_DIRS.workbenches, id, "state.json"))) return true;
      }
      return false;
    })
    .catch(() => false);
  return {
    manifest: {
      format: ARCHIVE_FORMAT,
      exportedAt: now.toISOString(),
      agentId: "",
      parts: {
        skills: await holds(PART_DIRS.skills),
        hooks: await holds(PART_DIRS.hooks),
        memory: await holds(PART_DIRS.memory),
        workbenches: await holds(PART_DIRS.workbenches),
        workbenchData,
        schedules: await holds(PART_DIRS.schedules),
        traces: { kind: "none" },
      },
      vaultKeys: [],
      redacted: [],
    },
    topDir: null,
    stateDir,
    hasConfig: await exists(path.join(stateDir, "system_config.yaml")),
    sessions: [],
  };
}
