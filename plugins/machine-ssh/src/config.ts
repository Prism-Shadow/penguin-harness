/**
 * `~/.ssh/config` as the ssh machine kind touches it: reading it for its host aliases (the
 * kind's `discover`), and appending or rewriting a host block a person composed on the
 * Machines page (its `define`). No host list of our own is kept and no alias is resolved: what
 * an alias means (user, host, port, key, jump host) is ssh's business, applied by ssh itself
 * every time it is handed the alias, so nothing here can go stale against a config a person
 * edits by hand. The writes are blocks in ssh's own syntax — the same lines the person would
 * have typed — led by a marker comment, so the file stays theirs and only our blocks are ever
 * rewritten.
 *
 * `parseHostAliases` scans the config text for candidate aliases, following `Include`
 * through a caller-supplied reader. It exists only because OpenSSH has no "list hosts"
 * command and the page needs something to show. Pattern entries (`*`, `?`, `!`) are skipped:
 * they configure other hosts rather than name one. Pure, like the block helpers, so they
 * unit-test without a filesystem; the I/O is at the bottom.
 *
 * An unreadable or missing config degrades to "no targets" rather than to an error: this list
 * is a convenience, and a user with no ssh setup should simply not be offered anything.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Config keywords that introduce host blocks; matched case-insensitively, as ssh does. */
const HOST_KEYWORD = /^host\s+(.*)$/i;
const INCLUDE_KEYWORD = /^include\s+(.*)$/i;

/** A pattern entry configures other hosts instead of naming one, so it is not a target. */
const isPattern = (alias: string) => /[*?!]/.test(alias);

/**
 * Host aliases declared in a config, in file order and de-duplicated. `readInclude` resolves
 * an `Include` argument to the included files' text (empty array when it matches nothing);
 * it is a parameter so this stays pure — the caller owns glob expansion, `~` resolution and
 * the "an unreadable include is not an error" policy.
 *
 * Depth is bounded: OpenSSH allows nested includes, and a config that includes itself would
 * otherwise spin forever.
 */
export function parseHostAliases(
  text: string,
  readInclude: (pattern: string) => string[],
  depth = 0,
): string[] {
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const include = INCLUDE_KEYWORD.exec(line);
    if (include && depth < 8) {
      for (const included of readInclude(include[1]!.trim())) {
        out.push(...parseHostAliases(included, readInclude, depth + 1));
      }
      continue;
    }
    const host = HOST_KEYWORD.exec(line);
    if (!host) continue;
    // `Host a b c` declares several aliases for one block.
    for (const alias of host[1]!.split(/\s+/)) {
      if (alias !== "" && !isPattern(alias)) out.push(alias);
    }
  }
  return [...new Set(out)];
}

/** A host block as the Machines page composes it: the alias, and what ssh needs to reach it. */
export interface SshHostEntry {
  alias: string;
  hostName: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/** Which field of an entry cannot be written, and why. */
export interface SshHostProblem {
  field: keyof SshHostEntry;
  why: "required" | "invalid";
}

/** A value that fits on one config line as one token: no whitespace, no comment, no newline. */
const isToken = (value: string) => value !== "" && !/[\s#]/.test(value);

/**
 * The first thing wrong with an entry, or null. Strict where ssh is lenient, because this
 * block is appended to a file a person also edits: an alias with a glob character would
 * declare a pattern, a value with a space would need quoting we do not do, and a `#` would
 * comment out the rest of its own line.
 */
export function validateHostEntry(entry: SshHostEntry): SshHostProblem | null {
  if (entry.alias.trim() === "") return { field: "alias", why: "required" };
  if (!isToken(entry.alias) || isPattern(entry.alias)) return { field: "alias", why: "invalid" };
  if (entry.hostName.trim() === "") return { field: "hostName", why: "required" };
  if (!isToken(entry.hostName)) return { field: "hostName", why: "invalid" };
  if (entry.user !== undefined && entry.user !== "" && !isToken(entry.user)) {
    return { field: "user", why: "invalid" };
  }
  if (
    entry.port !== undefined &&
    (!Number.isInteger(entry.port) || entry.port < 1 || entry.port > 65535)
  ) {
    return { field: "port", why: "invalid" };
  }
  if (
    entry.identityFile !== undefined &&
    entry.identityFile !== "" &&
    !isToken(entry.identityFile)
  ) {
    return { field: "identityFile", why: "invalid" };
  }
  return null;
}

/**
 * The block as ssh reads it, led by a comment naming who wrote it and when — so a person
 * reading their config later knows the lines are not theirs and may edit or drop them.
 * Options ssh would ignore for being empty are left out rather than written blank.
 */
export function renderHostBlock(entry: SshHostEntry, at: Date): string {
  const lines = [
    `# Added by PenguinHarness on ${at.toISOString()}`,
    `Host ${entry.alias.trim()}`,
    `  HostName ${entry.hostName.trim()}`,
  ];
  if (entry.user !== undefined && entry.user !== "") lines.push(`  User ${entry.user.trim()}`);
  if (entry.port !== undefined) lines.push(`  Port ${entry.port}`);
  if (entry.identityFile !== undefined && entry.identityFile !== "") {
    lines.push(`  IdentityFile ${entry.identityFile.trim()}`);
  }
  return lines.join("\n") + "\n";
}

/** The comment `renderHostBlock` leads with; a block that carries it is one this app wrote. */
const MARKER = /^# Added by PenguinHarness on /;
const OPTION = /^(\S+)\s+(.*)$/;

/** A host block found in a config: its lines (`start` to `end`, exclusive), what it says, and whether this app wrote it. */
export interface HostBlockFound {
  start: number;
  end: number;
  entry: SshHostEntry;
  ours: boolean;
}

/**
 * The block declaring exactly `alias` — a `Host` line naming that one alias and nothing
 * else — with the options this app knows read back out of it. The block runs to the next
 * `Host` or `Match` line or the end of the file, less any trailing blank lines, and takes in
 * the marker comment above it when there is one, so replacing the block replaces the
 * comment too. A `Host a b` line is not a match: it configures two aliases at once, and
 * rewriting it as one would drop the other.
 */
export function findHostBlock(text: string, alias: string): HostBlockFound | null {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const host = HOST_KEYWORD.exec(lines[i]!.trim());
    if (!host) continue;
    const aliases = host[1]!.split(/\s+/).filter((entry) => entry !== "");
    if (aliases.length !== 1 || aliases[0] !== alias) continue;
    let end = i + 1;
    while (end < lines.length && !/^(host|match)\s/i.test(lines[end]!.trim())) end++;
    while (end > i + 1 && lines[end - 1]!.trim() === "") end--;
    const ours = i > 0 && MARKER.test(lines[i - 1]!.trim());
    const entry: SshHostEntry = { alias, hostName: "" };
    for (const raw of lines.slice(i + 1, end)) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      const option = OPTION.exec(line);
      if (!option) continue;
      const key = option[1]!.toLowerCase();
      const value = option[2]!.trim();
      if (key === "hostname") entry.hostName = value;
      else if (key === "user") entry.user = value;
      else if (key === "port") {
        const port = Number(value);
        if (Number.isInteger(port)) entry.port = port;
      } else if (key === "identityfile") entry.identityFile = value;
    }
    return { start: ours ? i - 1 : i, end, entry, ours };
  }
  return null;
}

/** The config with `found`'s lines replaced by a freshly rendered block. */
export function replaceHostBlock(text: string, found: HostBlockFound, block: string): string {
  const lines = text.split("\n");
  lines.splice(found.start, found.end - found.start, ...block.replace(/\n$/, "").split("\n"));
  return lines.join("\n");
}

// --- the file itself -----------------------------------------------------------------------

/** Where the config is: `~/.ssh`, or wherever a test points it. */
let sshDirOverride: string | null = null;
const SSH_DIR = () => sshDirOverride ?? path.join(os.homedir(), ".ssh");

/** Points the config I/O at another directory — a test's, never a person's. */
export function useSshDir(dir: string | null): void {
  sshDirOverride = dir;
}

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
 * Appends a rendered host block to `~/.ssh/config`, creating the directory and the file with
 * the modes ssh insists on when they do not exist yet (0700 and 0600; ssh refuses a config
 * others can write). A blank line separates the block from whatever came before, and a file
 * that did not end in a newline gets one first, so the block never joins a foreign line.
 */
export function appendHostBlock(block: string): void {
  const dir = SSH_DIR();
  const file = path.join(dir, "config");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  let existing = "";
  try {
    existing = fs.readFileSync(file, "utf8");
  } catch {
    fs.writeFileSync(file, "", { mode: 0o600 });
  }
  const lead = existing === "" ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  fs.appendFileSync(file, lead + block);
}

/** The config's text, or null when there is none to read. */
export function readSshConfig(): string | null {
  try {
    return fs.readFileSync(path.join(SSH_DIR(), "config"), "utf8");
  } catch {
    return null;
  }
}

/** Writes the config back whole — after a block this app wrote was rewritten in place. */
export function writeSshConfig(text: string): void {
  fs.writeFileSync(path.join(SSH_DIR(), "config"), text, { mode: 0o600 });
}
