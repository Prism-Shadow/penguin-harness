/**
 * Where agent-desktop keeps its refs: one state directory per PenguinHarness Session.
 *
 * agent-desktop stores every snapshot's ref map under its state root (`AGENT_DESKTOP_HOME`), so a
 * ref taken by one process works in the next. Giving each Session its own root keeps one
 * conversation's refs out of another's without agent-desktop's `--session`, whose namespaces a
 * later call has to name again. A command run outside a Session (a person at a terminal) uses its
 * user's own root.
 *
 *   <data root>/computer-use/state/sessions/<sessionId>/
 *   <data root>/computer-use/state/users/<userId>/
 *   <data root>/computer-use/state/launch/                what `launch` runs with (see launchDirOf)
 *   <data root>/computer-use/tmp/                         screenshots on their way to the terminal
 *
 * agent-desktop refuses a root that is not private (0700, the user's own, not a symlink), so
 * each is made that way. No plugin hears when a Session is deleted, so a root unused for
 * STATE_MAX_AGE_MS is swept instead, when the module starts and at most once an hour after.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const STATE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export function stateRootOf(root: string): string {
  return path.join(root, "computer-use", "state");
}

/**
 * The state directory `launch` runs with: agent-desktop passes `AGENT_DESKTOP_HOME` on to the app
 * it starts, so the app is shown this one, which holds no Session's refs, rather than a Session's.
 */
export async function launchDirOf(root: string): Promise<string> {
  const dir = path.join(stateRootOf(root), "launch");
  await mkdirPrivate(root, dir);
  return dir;
}

export function tmpDirOf(root: string): string {
  return path.join(root, "computer-use", "tmp");
}

/** An id as a directory name: itself when it is a plain name, else a digest of it. */
function segment(id: string): string {
  return /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(id)
    ? id
    : createHash("sha256").update(id).digest("hex").slice(0, 32);
}

/** Makes `dir` and the levels above it down from `base`, each private to this user. */
export async function mkdirPrivate(base: string, dir: string): Promise<void> {
  const parts = path
    .relative(base, dir)
    .split(path.sep)
    .filter((p) => p !== "");
  let at = base;
  for (const part of parts) {
    at = path.join(at, part);
    try {
      await fs.mkdir(at, { mode: 0o700 });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
    const st = await fs.lstat(at);
    if (!st.isDirectory()) throw new Error(`${at} is not a directory`);
    if (process.platform !== "win32" && (st.mode & 0o077) !== 0) await fs.chmod(at, 0o700);
  }
}

/** The caller's state directory, made private and marked as used now. */
export async function stateDirFor(
  root: string,
  caller: { sessionId?: string; userId: string },
): Promise<string> {
  const dir =
    caller.sessionId !== undefined
      ? path.join(stateRootOf(root), "sessions", segment(caller.sessionId))
      : path.join(stateRootOf(root), "users", segment(caller.userId));
  await mkdirPrivate(root, dir);
  const now = new Date();
  await fs.utimes(dir, now, now);
  return dir;
}

/** Removes the state directories not used for `maxAgeMs`; answers how many went. */
export async function sweepStateDirs(
  root: string,
  maxAgeMs: number = STATE_MAX_AGE_MS,
  now: number = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const kind of ["sessions", "users"]) {
    const dir = path.join(stateRootOf(root), kind);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const at = path.join(dir, name);
      try {
        const st = await fs.lstat(at);
        if (now - st.mtimeMs > maxAgeMs) {
          await fs.rm(at, { recursive: true, force: true });
          removed++;
        }
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  }
  return removed;
}
