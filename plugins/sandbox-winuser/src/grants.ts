/**
 * The policy, expressed as Windows permissions.
 *
 * This backend confines by IDENTITY, not by a container: the command runs as an account that
 * owns nothing, so the whole policy is "what may that account reach". Everything the account
 * is not granted is already denied — a second user cannot read `C:\Users\<you>` — which is why
 * the grants below are additive and short, and why nothing here has to model a whole filesystem.
 *
 *   workspace-write   the Workspace: Modify, inheritable
 *   read-only         the Workspace: Read and Execute, inheritable
 *   [both]            the program's own directory: Read and Execute (the shell must load)
 *   mask-paths        an explicit Deny, which outranks every grant above
 *
 * Grants are made to the GROUP the setup created, never to one account, so a path opened for
 * the offline account is open to the online one too and switching the network policy needs no
 * repermissioning. They are also idempotent: a path already carrying the entry is left alone,
 * because `icacls` walks a tree and a Workspace can be large.
 */
import { execFileSync } from "node:child_process";

/** How a path is opened to the sandbox accounts. */
export type Access = "modify" | "read";

const RIGHTS: Record<Access, string> = { modify: "(OI)(CI)(M)", read: "(OI)(CI)(RX)" };

/** Runs one `icacls` and says whether it succeeded, never throwing on a path that is gone. */
function icacls(args: string[], timeoutMs: number): { ok: boolean; output: string } {
  try {
    const out = execFileSync("icacls", args, {
      encoding: "utf8",
      timeout: timeoutMs,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true, output: out };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string };
    return { ok: false, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Does `path` already carry an entry for `group` of this shape? (`icacls` prints them all.) */
export function hasEntry(
  target: string,
  group: string,
  rights: string,
  timeoutMs = 20_000,
): boolean {
  const listed = icacls([target], timeoutMs);
  if (!listed.ok) return false;
  return listed.output.split(/\r?\n/).some((line) => line.includes(group) && line.includes(rights));
}

/**
 * Opens `target` to the sandbox group at `access`, unless it is open already. Returns what went
 * wrong, or null when the path is reachable — an absent path is not an error, since a policy may
 * name a Workspace that a command is about to create.
 */
export function grant(
  target: string,
  group: string,
  access: Access,
  timeoutMs = 120_000,
): string | null {
  const rights = RIGHTS[access];
  if (hasEntry(target, group, rights, 20_000)) return null;
  // Entries ACCUMULATE: a Workspace opened for writing keeps that entry when the mode later
  // says read-only, and the command writes anyway. So whatever this group held here goes first,
  // and the access the policy asks for is what remains. (Masked paths are denied separately and
  // never cleared here.)
  icacls([target, "/remove:g", group], timeoutMs);
  const done = icacls([target, "/grant", `${group}:${rights}`], timeoutMs);
  return done.ok
    ? null
    : `could not open ${target} to ${group}: ${done.output.trim().slice(0, 200)}`;
}

/**
 * Hides `target` from the sandbox group. A Deny entry outranks every grant, including one
 * inherited from a Workspace the command may write, which is what `mask-paths` promises.
 */
export function deny(target: string, group: string, timeoutMs = 120_000): string | null {
  if (hasEntry(target, group, "(DENY)", 20_000)) return null;
  const done = icacls([target, "/deny", `${group}:(OI)(CI)(F)`], timeoutMs);
  return done.ok
    ? null
    : `could not hide ${target} from ${group}: ${done.output.trim().slice(0, 200)}`;
}
