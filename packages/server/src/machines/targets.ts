/**
 * Turning `~/.ssh/config` into a list of targets the menu can show, and one target into what
 * ssh actually resolved. The parsing is in ssh-config.ts; this file owns the I/O — reading
 * files, expanding `Include` globs, and asking ssh itself with `ssh -G`.
 *
 * An unreadable config, a missing config or an ssh that will not answer all degrade to "no
 * targets" rather than to an error: this list is a convenience, and a user with no ssh setup
 * should simply not see the feature offer them anything.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { run } from "./exec.js";
import { machineIdentity, parseHostAliases, parseSshSettings } from "./ssh-config.js";
import type { SshSettings } from "./ssh-config.js";

const SSH_DIR = () => path.join(os.homedir(), ".ssh");

/**
 * Resolves one `Include` argument to the text of the files it matches. Patterns are relative
 * to ~/.ssh unless absolute, and only the last path segment may glob — which is what
 * OpenSSH's own configs use (`Include config.d/*`), and all this list needs.
 */
function readIncluded(pattern: string): string[] {
  const expanded = pattern.startsWith("~/")
    ? path.join(os.homedir(), pattern.slice(2))
    : path.isAbsolute(pattern)
      ? pattern
      : path.join(SSH_DIR(), pattern);
  const dir = path.dirname(expanded);
  const base = path.basename(expanded);
  try {
    if (!base.includes("*") && !base.includes("?")) return [fs.readFileSync(expanded, "utf8")];
    const matcher = new RegExp(
      `^${base.replaceAll(".", "\\.").replaceAll("*", ".*").replaceAll("?", ".")}$`,
    );
    return fs
      .readdirSync(dir)
      .filter((entry) => matcher.test(entry))
      .sort()
      .map((entry) => {
        try {
          return fs.readFileSync(path.join(dir, entry), "utf8");
        } catch {
          return "";
        }
      });
  } catch {
    return []; // Missing or unreadable include: OpenSSH ignores it, so do we.
  }
}

/** Host aliases declared in this machine's ssh config; empty when there is no usable config. */
export function listHostAliases(): string[] {
  try {
    return parseHostAliases(fs.readFileSync(path.join(SSH_DIR(), "config"), "utf8"), readIncluded);
  } catch {
    return [];
  }
}

/**
 * What ssh resolves an alias to, via `ssh -G` — Match blocks, Include and wildcard
 * inheritance included, because ssh does the resolving, not us. Null when ssh cannot be run
 * or refuses the alias.
 */
export type ResolvedTarget = { alias: string; settings: SshSettings; machine: string };

/**
 * Resolutions, briefly. `ssh -G` never connects — it parses config — but it is still a
 * process spawn, and it sits in front of every directory listing and every probe. Repeating
 * it per click costs more than the command it precedes.
 *
 * Short-lived on purpose: ~/.ssh/config is a file a person edits, and a resolution that
 * outlived their edit would keep sending work to the host they just repointed away from.
 * A minute is long enough to cover a burst of browsing and short enough that an edit is
 * noticed about as fast as it would have been anyway.
 */
const RESOLVE_TTL_MS = 60_000;
const resolved = new Map<string, { at: number; value: ResolvedTarget | null }>();

/** Forgets cached resolutions — for a config that is known to have changed. */
export function forgetResolvedTargets(): void {
  resolved.clear();
}

export async function resolveTarget(alias: string): Promise<ResolvedTarget | null> {
  const hit = resolved.get(alias);
  if (hit !== undefined && Date.now() - hit.at < RESOLVE_TTL_MS) return hit.value;
  const result = await run("ssh", ["-G", alias], { timeoutMs: 15_000 });
  if (result.code !== 0 && result.stdout.trim() === "") {
    // A failure is cached too, briefly: an alias ssh cannot name will not start working
    // within the minute, and re-asking per click makes a broken host the slowest one.
    resolved.set(alias, { at: Date.now(), value: null });
    return null;
  }
  const settings = parseSshSettings(result.stdout, alias);
  const value = { alias, settings, machine: machineIdentity(alias, settings.user) };
  resolved.set(alias, { at: Date.now(), value });
  return value;
}
