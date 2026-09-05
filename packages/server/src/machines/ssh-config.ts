/**
 * `~/.ssh/config` as this app touches it: reading it for its host aliases, and appending a
 * host block a person composed in the Machines page. We never keep a host list of our own
 * and never resolve an alias: what it means (user, host, port, key, jump host) is ssh's
 * business, applied by ssh itself every time it is handed the alias, so nothing here can go
 * stale against a config a person edits by hand. The one write is an append of a block in
 * ssh's own syntax — the same lines the person would have typed — so the file stays theirs.
 *
 * `parseHostAliases` scans the config text for candidate aliases, following `Include`
 * through a caller-supplied reader. It exists only because OpenSSH has no "list hosts"
 * command and the UI needs something to show. Pattern entries (`*`, `?`, `!`) are skipped:
 * they configure other hosts rather than name one. Pure, so it unit-tests without a
 * filesystem.
 */

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

/**
 * A remote target's stable name: the SSH identity, `<user>@<alias>`. The Linux account is
 * part of it because each account has its own `~/.penguin` — hence its own server, its own
 * accounts — so `deploy@build-box` and `root@build-box` are two machines as far as anything
 * downstream is concerned.
 * The ALIAS is used rather than the resolved hostname: it is what the user chose, it is
 * what survives a DNS or jump-host change, and two aliases for one host are two targets
 * only if the user wrote them that way.
 */
export function machineIdentity(alias: string, user: string): string {
  return user === "" ? alias : `${user}@${alias}`;
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
