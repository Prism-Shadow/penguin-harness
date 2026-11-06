/**
 * Replacing an Agent's `agent_state/` with an imported one, and putting things back when that
 * fails part-way — even across a crash.
 *
 * Everything the swap moves lives in one folder under the Agent, `<agentDir>/.import-<12 hex>/`,
 * on the same filesystem, so every step is a rename:
 *
 * 1. the folder is made and marked (`.penguin-swap.json`: the backup's path, the entries the
 *    new State keeps from the old one, and the phase, `staged`);
 * 2. the new State moves in as `incoming/`, and the current vault is written into it;
 * 3. the mark turns `aside`, and the current State moves aside as `replaced-agent_state/`;
 * 4. each kept entry moves from `replaced-agent_state/` into `incoming/`;
 * 5. `incoming/` becomes `agent_state/`, and the mark turns `committed`. The folder, which now
 *    holds only the superseded State (also in the backup), is removed.
 *
 * When a step from 3 on fails, the previous State is restored and the kept entries move back.
 * A move back that fails too leaves the folder and its mark in place: nothing the Agent had is
 * removed, the error names the folder and the backup, and the next import of that Agent or the
 * next server start (`recoverStrandedSwaps`) puts back what the folder holds. A crash between
 * 3 and 5 leaves the same marked folder, recovered the same way.
 *
 * Recovery goes by the phase, never by what happens to be missing: only a swap that did not
 * commit has its originals restored, and only into places that are empty; a committed swap's
 * folder is superseded by the State it produced, so its leftovers are removed (the backup holds
 * them) and never installed. The caller holds the Agent for the whole import, so recovery never
 * meets a swap still running.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  agentDir,
  agentStateDir,
  agentVaultPath,
  agentsDir,
  isValidId,
} from "@prismshadow/penguin-core";
import { HttpError } from "../http/errors.js";
import { VAULT_BASENAME } from "./agent-state-layout.js";

/** The prefix of a swap's folder under the Agent directory. */
export const SWAP_PREFIX = ".import-";
/** The mark of a folder that may hold the Agent's State or parts of it. */
export const SWAP_MARK = ".penguin-swap.json";

const INCOMING = "incoming";
const REPLACED = "replaced-agent_state";

type SwapPhase = "staged" | "aside" | "committed";

interface SwapMark {
  phase: SwapPhase;
  backup: string | null;
  carry: string[];
  startedAt: string;
}

/** Writes the folder's mark whole: to a temporary name, then renamed over the old one. */
async function writeMark(folder: string, mark: SwapMark): Promise<void> {
  const file = path.join(folder, SWAP_MARK);
  await fs.writeFile(`${file}.tmp`, `${JSON.stringify(mark, null, 2)}\n`);
  await fs.rename(`${file}.tmp`, file);
}

const exists = (file: string): Promise<boolean> =>
  fs.lstat(file).then(
    () => true,
    () => false,
  );

const at = (dir: string, rel: string): string => path.join(dir, ...rel.split("/"));

/** The 500 a swap answers when it could not put everything back. */
function stranded(folder: string, backup: string | null): HttpError {
  return new HttpError(
    500,
    "import_rollback_failed",
    `The import failed and the Agent's previous State could not be put back in full. What was ` +
      `moved aside is kept in ${folder}; it is moved back at the next import of this Agent or ` +
      `the next server start.` +
      (backup !== null ? ` The State before the import is also in ${backup}.` : ""),
  );
}

/**
 * Replaces the Agent's State with `incoming` (a directory on the same filesystem, checked by the
 * caller), keeping the current vault and the current State's entries at the `carry` paths
 * (relative to `agent_state/`, `/`-separated; each replaces whatever `incoming` holds there).
 * `backup` is the snapshot taken before (`snapshots/…`, relative to the Agent directory), named
 * by an error that leaves something behind.
 */
export async function swapAgentState(
  root: string,
  log: (line: string) => void,
  projectId: string,
  agentId: string,
  incoming: string,
  carry: readonly string[],
  backup: string | null,
): Promise<void> {
  const base = agentDir(root, projectId, agentId);
  const stateDir = agentStateDir(root, projectId, agentId);
  const folder = path.join(base, `${SWAP_PREFIX}${randomBytes(6).toString("hex")}`);
  const moved = path.join(folder, INCOMING);
  const replaced = path.join(folder, REPLACED);
  await fs.mkdir(folder);
  const mark: SwapMark = {
    phase: "staged",
    backup,
    carry: [...carry],
    startedAt: new Date().toISOString(),
  };
  await writeMark(folder, mark);
  let keep = false;
  try {
    await fs.rename(incoming, moved);
    // Only a missing vault means there is nothing to keep: any other read failure stops the swap
    // before anything of the Agent's moves, because it would otherwise discard the only copy.
    let vault: Buffer | null = null;
    try {
      vault = await fs.readFile(agentVaultPath(root, projectId, agentId));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    if (vault !== null) {
      await fs.writeFile(path.join(moved, VAULT_BASENAME), vault, { mode: 0o600 });
    }
    await writeMark(folder, { ...mark, phase: "aside" });
    await fs.rename(stateDir, replaced);
    const carried: string[] = [];
    try {
      for (const rel of carry) {
        await fs.rm(at(moved, rel), { recursive: true, force: true });
        await fs.mkdir(path.dirname(at(moved, rel)), { recursive: true });
        await fs.rename(at(replaced, rel), at(moved, rel));
        carried.push(rel);
      }
      await fs.rename(moved, stateDir);
      // Committed: should the folder outlive this (a failed removal, a crash), recovery knows its
      // leftovers are superseded. A mark that cannot be written is no loss: recovery reads a
      // vanished `incoming/` the same way.
      await writeMark(folder, { ...mark, phase: "committed" }).catch(() => undefined);
    } catch (err) {
      // Rollback: the previous State is restored, then the kept entries move back into it,
      // each to the place it left, empty since. Anything that does not move stays in the
      // marked folder.
      let restored = false;
      try {
        await fs.rename(replaced, stateDir);
        restored = await moveBack(log, folder, stateDir, carried);
      } catch {
        restored = false;
      }
      if (!restored) {
        keep = true;
        log(`[snapshots] import of ${projectId}/${agentId} left the previous State in ${folder}`);
        throw stranded(folder, backup);
      }
      throw err;
    }
  } finally {
    if (!keep) {
      await fs.rm(folder, { recursive: true, force: true }).catch((err: unknown) => {
        log(`[snapshots] import staging directory could not be removed: ${folder}: ${String(err)}`);
      });
    }
  }
}

/**
 * Moves each kept entry still in `folder/incoming` back into `stateDir` when its place there is
 * empty; logs the ones it cannot. Answers whether all are back.
 */
async function moveBack(
  log: (line: string) => void,
  folder: string,
  stateDir: string,
  carry: readonly string[],
): Promise<boolean> {
  let all = true;
  for (const rel of carry) {
    const from = at(path.join(folder, INCOMING), rel);
    if (!(await exists(from))) continue;
    const to = at(stateDir, rel);
    if (await exists(to)) {
      log(`[snapshots] ${from} was not moved back: ${to} exists; move it by hand`);
      all = false;
      continue;
    }
    try {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
    } catch (err) {
      log(`[snapshots] ${from} could not be moved back to ${to}: ${String(err)}`);
      all = false;
    }
  }
  return all;
}

/**
 * Puts back what one marked folder holds of the Agent, by its phase; removes the folder once
 * nothing of the Agent's is left in it.
 */
async function recoverFolder(
  log: (line: string) => void,
  stateDir: string,
  folder: string,
): Promise<void> {
  let mark: SwapMark;
  try {
    mark = JSON.parse(await fs.readFile(path.join(folder, SWAP_MARK), "utf8")) as SwapMark;
  } catch {
    return; // No mark: not a swap this code made; left for a person to look at.
  }
  const moved = path.join(folder, INCOMING);
  const replaced = path.join(folder, REPLACED);
  const carry = Array.isArray(mark.carry) ? mark.carry.filter((r) => typeof r === "string") : [];
  // A mark from before phases were recorded reads as `aside`: what is missing then decides.
  const phase: SwapPhase = mark.phase ?? "aside";
  const remove = async (why: string): Promise<void> => {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    log(`[snapshots] ${why}: ${folder}`);
  };
  // Committed: the Agent's State is the one this swap produced. `incoming/` gone with a State in
  // place means the same, for a mark the swap had no time to update.
  if (
    phase === "committed" ||
    (phase === "aside" && !(await exists(moved)) && (await exists(stateDir)))
  ) {
    await remove("removed the leftovers of a committed import (its backup holds them)");
    return;
  }
  if (phase !== "aside") {
    // `staged`: the Agent's State never moved; the folder holds the import's files only.
    await remove("removed an import that stopped before the State moved");
    return;
  }
  if (!(await exists(stateDir)) && (await exists(replaced))) {
    try {
      await fs.rename(replaced, stateDir);
    } catch (err) {
      log(`[snapshots] ${replaced} could not be moved back to ${stateDir}: ${String(err)}`);
      return;
    }
  }
  if (await exists(replaced)) {
    log(`[snapshots] ${folder} holds a previous State while ${stateDir} exists; left in place`);
    return;
  }
  if (!(await exists(stateDir)) || !(await moveBack(log, folder, stateDir, carry))) return;
  await remove("recovered an interrupted import");
}

async function recoverAgent(
  root: string,
  log: (line: string) => void,
  projectId: string,
  agentId: string,
): Promise<void> {
  const base = agentDir(root, projectId, agentId);
  const names = await fs.readdir(base).catch(() => [] as string[]);
  for (const name of names.filter((n) => n.startsWith(SWAP_PREFIX)).sort()) {
    await recoverFolder(log, agentStateDir(root, projectId, agentId), path.join(base, name));
  }
}

/**
 * Puts back what interrupted swaps left (see the header), for one Agent or for every Agent of
 * every Project under `root`.
 */
export async function recoverStrandedSwaps(
  root: string,
  log: (line: string) => void,
  scope?: { projectId: string; agentId: string },
): Promise<void> {
  if (scope !== undefined) {
    await recoverAgent(root, log, scope.projectId, scope.agentId);
    return;
  }
  const projects = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const project of projects) {
    if (!project.isDirectory() || !isValidId(project.name)) continue;
    const agents = await fs
      .readdir(agentsDir(root, project.name), { withFileTypes: true })
      .catch(() => []);
    for (const agent of agents) {
      if (agent.isDirectory() && isValidId(agent.name)) {
        await recoverAgent(root, log, project.name, agent.name);
      }
    }
  }
}
