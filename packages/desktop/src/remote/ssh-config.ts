/**
 * Reading `~/.ssh/config` — the only source of remote targets. We never write it, never
 * keep a host list of our own, and never re-implement OpenSSH's matching rules: this module
 * does exactly two things, both pure so they unit-test without a filesystem or an ssh binary.
 *
 * 1. `parseHostAliases` scans the config text for candidate aliases, following `Include`
 *    through a caller-supplied reader. It exists only because OpenSSH has no "list hosts"
 *    command and the UI needs something to show. Pattern entries (`*`, `?`, `!`) are skipped:
 *    they configure other hosts rather than name one.
 * 2. `parseSshSettings` reads the output of `ssh -G <alias>`, which is OpenSSH's own answer
 *    to "what does this alias actually resolve to" — Match blocks, Include, wildcard
 *    inheritance and defaults all already applied.
 */

/** One line of `ssh -G` output: a lowercase keyword, a space, the value. */
const SSH_G_LINE = /^([a-z0-9_]+)\s+(.*)$/;

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

/** The parts of `ssh -G` output this app uses; everything else in that output is ignored. */
export interface SshSettings {
  /** The login user ssh would use — part of a target's identity, not a detail. */
  user: string;
  hostname: string;
  port: number;
  /** May be empty: an agent-only setup declares no identity file. */
  identityFiles: string[];
  /** `none` in ssh's output becomes null. */
  proxyJump: string | null;
}

/**
 * Parses `ssh -G <alias>`. Absent or malformed fields fall back to ssh's own defaults
 * rather than throwing: this feeds a host picker, and a config we cannot fully read should
 * degrade to "looks like the alias itself on port 22", not to an error dialog.
 */
export function parseSshSettings(output: string, alias: string): SshSettings {
  const values = new Map<string, string[]>();
  for (const raw of output.split("\n")) {
    const match = SSH_G_LINE.exec(raw.trim());
    if (!match) continue;
    const key = match[1]!;
    const value = match[2]!.trim();
    const existing = values.get(key);
    if (existing) existing.push(value);
    else values.set(key, [value]);
  }
  const first = (key: string): string | null => values.get(key)?.[0] ?? null;
  const port = Number(first("port"));
  const proxyJump = first("proxyjump");
  return {
    user: first("user") ?? "",
    hostname: first("hostname") ?? alias,
    port: Number.isInteger(port) && port > 0 && port <= 65535 ? port : 22,
    identityFiles: values.get("identityfile") ?? [],
    proxyJump: proxyJump === null || proxyJump.toLowerCase() === "none" ? null : proxyJump,
  };
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
