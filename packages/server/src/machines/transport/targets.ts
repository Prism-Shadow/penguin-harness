/**
 * Turning `~/.ssh/config` into the list of aliases the menu can show, and appending a host
 * block to it. The parsing and the rendering are in ssh-config.ts; this file owns the I/O —
 * reading files, expanding `Include` globs, and the one append.
 *
 * Nothing here resolves an alias: what it means is ssh's business, applied by ssh itself
 * every time it is handed one. An unreadable or missing config degrades to "no targets"
 * rather than to an error: this list is a convenience, and a user with no ssh setup should
 * simply not see the feature offer them anything.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseHostAliases } from "../ssh-config.js";

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
