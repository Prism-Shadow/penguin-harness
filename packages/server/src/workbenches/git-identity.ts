/**
 * Who an Agent State version is by: the author and committer lines of its commit.
 *
 * Git's own order, field by field, without running git and without writing anything:
 *
 *   name   GIT_<ROLE>_NAME   → config <role>.name   → config user.name   → "PenguinHarness"
 *   email  GIT_<ROLE>_EMAIL  → config <role>.email  → config user.email  → EMAIL → "penguin@localhost"
 *
 * where ROLE is AUTHOR or COMMITTER and a role's own key beats `user.*` from any file, as in git.
 * The config is the repository's own `config` over the global file — `$GIT_CONFIG_GLOBAL` when it
 * is set, else `$XDG_CONFIG_HOME/git/config` (default `~/.config/git/config`) and then
 * `~/.gitconfig` — the later file winning a key. Only the `[user]`, `[author]` and `[committer]`
 * sections are read; `include` and `includeIf` are not followed, and the system file is not read.
 *
 * A version a member asked for (a restore, a reload, an import, a switch, a deletion) is AUTHORED
 * by that member: their display name and their email, each when the account has one, come before
 * everything above. Accounts carry no email today, so a member's version takes its email from the
 * order above. The committer is always the server's own identity — the one that wrote the commit.
 *
 * Both engines get the result, so the same version carries the same lines under either. Git
 * forbids `<`, `>` and line breaks in either field; they are dropped, and a field left empty by
 * that falls through to the next source.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentStateIdentity } from "@prismshadow/penguin-core/plugin";

/** The member a version is by, as far as the account says: each field when it has one. */
export interface VersionAuthor {
  name?: string;
  email?: string;
}

/** Where the server's own identity is read from: the process's, unless a test hands its own. */
export interface IdentitySources {
  env: Readonly<Record<string, string | undefined>>;
  home: string;
  readFile(file: string): string | null;
}

export const DEFAULT_IDENTITY: AgentStateIdentity = {
  name: "PenguinHarness",
  email: "penguin@localhost",
};

export function processIdentitySources(): IdentitySources {
  return {
    env: process.env,
    home: os.homedir(),
    readFile: (file) => {
      try {
        return fs.readFileSync(file, "utf8");
      } catch {
        return null;
      }
    },
  };
}

const KEYS = new Set([
  "user.name",
  "user.email",
  "author.name",
  "author.email",
  "committer.name",
  "committer.email",
]);

/** A field as git would take it: without `<`, `>` and line breaks, trimmed; "" when nothing is left. */
function clean(value: string | undefined): string {
  return (value ?? "").replace(/[<>\r\n\0]/g, "").trim();
}

/**
 * The identity keys a git config file sets, the last occurrence of each winning. A minimal reader
 * of git's format: section headers (a subsection makes it another section, not read), `key =
 * value` and a bare `key`, comments after `#` or `;` outside quotes, double quotes, the escapes
 * `\"` `\\` `\n` `\t` `\b`, and a backslash continuing a line.
 */
export function identityKeys(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let section = "";
  let i = 0;
  const n = text.length;
  const skipLine = () => {
    while (i < n && text[i] !== "\n") i++;
  };
  while (i < n) {
    const c = text[i]!;
    if (c === "\n" || c === " " || c === "\t" || c === "\r") {
      i++;
      continue;
    }
    if (c === "#" || c === ";") {
      skipLine();
      continue;
    }
    if (c === "[") {
      const close = text.indexOf("]", i);
      if (close === -1) return out;
      const header = text.slice(i + 1, close).trim();
      // `[user "x"]` and `[user.x]` are subsections: other sections, never read here.
      section =
        /^[A-Za-z0-9.-]+$/.test(header) && !header.includes(".") ? header.toLowerCase() : "";
      i = close + 1;
      continue;
    }
    const name = /^[A-Za-z][A-Za-z0-9-]*/.exec(text.slice(i))?.[0];
    if (name === undefined) {
      skipLine();
      continue;
    }
    i += name.length;
    while (i < n && (text[i] === " " || text[i] === "\t")) i++;
    let value: string | null = null;
    if (text[i] === "=") {
      i++;
      // As git's parse_value: whitespace outside quotes is dropped at the ends and becomes one
      // space per character inside; quotes are removed; a comment runs to the end of the line.
      let raw = "";
      let quoted = false;
      let spaces = 0;
      while (i < n) {
        let ch = text[i]!;
        i++;
        if (ch === "\r" && text[i] === "\n") {
          ch = "\n";
          i++;
        }
        if (ch === "\n") break;
        if (/\s/.test(ch) && !quoted) {
          if (raw.length > 0) spaces++;
          continue;
        }
        if ((ch === "#" || ch === ";") && !quoted) {
          skipLine();
          break;
        }
        raw += " ".repeat(spaces);
        spaces = 0;
        if (ch === "\\") {
          let next = text[i];
          i++;
          if (next === "\r" && text[i] === "\n") {
            next = "\n";
            i++;
          }
          if (next === "\n") continue;
          raw += next === "n" ? "\n" : next === "t" ? "\t" : next === "b" ? "\b" : (next ?? "");
          continue;
        }
        if (ch === '"') {
          quoted = !quoted;
          continue;
        }
        raw += ch;
      }
      value = raw;
    }
    const key = `${section}.${name.toLowerCase()}`;
    if (section !== "" && KEYS.has(key) && value !== null) out.set(key, value);
  }
  return out;
}

/** The files git reads the identity from, lowest precedence first. */
function configFiles(gitdir: string, sources: IdentitySources): string[] {
  const { env, home } = sources;
  const global =
    env.GIT_CONFIG_GLOBAL !== undefined
      ? env.GIT_CONFIG_GLOBAL === ""
        ? []
        : [env.GIT_CONFIG_GLOBAL]
      : [
          path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "git", "config"),
          path.join(home, ".gitconfig"),
        ];
  return [...global, path.join(gitdir, "config")];
}

/** The server's config keys, every file merged, the later file winning. */
function configKeys(gitdir: string, sources: IdentitySources): Map<string, string> {
  const merged = new Map<string, string>();
  for (const file of configFiles(gitdir, sources)) {
    const text = sources.readFile(file);
    if (text === null) continue;
    for (const [key, value] of identityKeys(text)) merged.set(key, value);
  }
  return merged;
}

/** The first of the candidates that is still something once cleaned. */
function first(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const value = clean(candidate);
    if (value !== "") return value;
  }
  return "";
}

/** The author and committer lines of one commit (see the module doc). */
export function versionIdentities(
  gitdir: string,
  sources: IdentitySources,
  by?: VersionAuthor,
): { author: AgentStateIdentity; committer: AgentStateIdentity } {
  const config = configKeys(gitdir, sources);
  const { env } = sources;
  const server = (role: "author" | "committer", member?: VersionAuthor): AgentStateIdentity => {
    const ROLE = role.toUpperCase();
    return {
      name:
        first(
          member?.name,
          env[`GIT_${ROLE}_NAME`],
          config.get(`${role}.name`),
          config.get("user.name"),
        ) || DEFAULT_IDENTITY.name,
      email:
        first(
          member?.email,
          env[`GIT_${ROLE}_EMAIL`],
          config.get(`${role}.email`),
          config.get("user.email"),
          env.EMAIL,
        ) || DEFAULT_IDENTITY.email,
    };
  };
  return { author: server("author", by), committer: server("committer") };
}
