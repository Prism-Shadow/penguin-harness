/**
 * Reading `~/.ssh/config` for its host aliases — the only thing this app takes from it. We
 * never write it, never keep a host list of our own, and never resolve it: what an alias
 * means (user, host, port, key, jump host) is ssh's business, applied by ssh itself every
 * time it is handed the alias, so nothing here can go stale against a config a person edits.
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
