/**
 * Which entry a plugin name resolves to: one rule for the content an install fetches
 * (http/routes/plugins-installed.ts), the package a load takes from this machine's prefixes
 * (plugin/prefix.ts `pickLocal`).
 */
import semver from "semver";

/** What one Project asks of a name: a version range, and optionally the exact content. */
export interface PluginAsk {
  version?: string;
  /** npm's integrity, `sha512-<base64>`: this content and no other. */
  integrity?: string;
}

/** Semver order; a version that does not parse sorts below every one that does. */
export function compareVersions(a: string, b: string): number {
  const va = semver.valid(a);
  const vb = semver.valid(b);
  if (va === null || vb === null) return va === null ? (vb === null ? 0 : -1) : 1;
  return semver.compare(va, vb);
}

/** Whether `version` satisfies `range`; none, `*` and `latest` admit every version. */
export function satisfies(version: string, range: string | undefined): boolean {
  const r = (range ?? "*").trim();
  if (r === "" || r === "*" || r === "latest") return true;
  return semver.valid(version) !== null && semver.satisfies(version, r);
}

/**
 * The entry `asks` resolve `name` to among `entries` (in precedence order), or why none: the
 * pinned content when one is pinned; otherwise the highest version every ask admits — among
 * equal versions a `preferred` one, else the earlier. An entry without an integrity is taken
 * only when `checked` is false (a package already on this machine): a fetched one could not be
 * checked. `where` names the entries in a refusal.
 */
export function pickEntry<E extends { name: string; version: string; integrity?: string }>(
  entries: readonly E[],
  name: string,
  asks: readonly PluginAsk[],
  {
    where,
    preferred = () => false,
    checked = true,
  }: { where: string; preferred?: (e: E) => boolean; checked?: boolean },
): E | { refused: string } {
  const listed = entries.filter((e) => e.name === name);
  if (listed.length === 0) return { refused: `'${name}' is not in ${where}` };
  const pins = [...new Set(asks.map((a) => a.integrity).filter((i): i is string => !!i))];
  if (pins.length > 1) {
    return {
      refused: `'${name}' is pinned to ${pins.length} different contents: ${pins.join(", ")}`,
    };
  }
  const wanted = asks.map((a) => a.integrity ?? a.version ?? "*").join(", ") || "*";
  const fits = listed.filter(
    (e) =>
      asks.every((a) => satisfies(e.version, a.version)) &&
      (pins.length === 0 || e.integrity === pins[0]),
  );
  if (fits.length === 0) {
    const versions = listed.map((e) => e.version).join(", ");
    return { refused: `no '${name}' in ${where} satisfies ${wanted} (there: ${versions})` };
  }
  // Array.prototype.sort is stable: among equal versions and preference the earlier stays first.
  const best = fits
    .filter((e) => !checked || e.integrity !== undefined)
    .sort(
      (a, b) =>
        compareVersions(b.version, a.version) || Number(preferred(b)) - Number(preferred(a)),
    )[0];
  if (best === undefined) {
    return {
      refused: `'${name}' ${wanted} is listed without an integrity, so a fetched copy could not be checked: it cannot be installed`,
    };
  }
  return best;
}

/** The index entry an install of `name` takes: `pickEntry` over the merged index. */
export function pickIndexEntry<E extends { name: string; version: string; integrity?: string }>(
  entries: readonly E[],
  name: string,
  ask: PluginAsk,
): E | { refused: string } {
  return pickEntry(entries, name, [ask], { where: "the plugin index's sources" });
}
