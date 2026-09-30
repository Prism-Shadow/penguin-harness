/**
 * Which plugin index entry a name resolves to — the one rule the server installs by
 * (http/routes/plugins-installed.ts) and the Plugins page shows a name's row by, so the row a
 * person reads is the content an install takes. Pure: no I/O, so the web bundles the same
 * copy through `@prismshadow/penguin-server/api`.
 */
import type { PluginIndexEntry } from "./types.js";

const byCodeUnit = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `1.2.3-rc.1` as numbers and a prerelease tag; null when it is not a version. */
function parseVersion(v: string): { nums: [number, number, number]; pre: string } | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(v.trim());
  if (m === null) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? "" };
}

/** Semver order; a version that does not parse sorts below every one that does. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa === null || pb === null) return pa === null ? (pb === null ? byCodeUnit(a, b) : -1) : 1;
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i]! - pb.nums[i]!;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === "") return 1;
  if (pb.pre === "") return -1;
  return byCodeUnit(pa.pre, pb.pre);
}

/**
 * Whether `version` satisfies `range`: `*` / empty / `latest`, an exact version, `^`, `~`, the
 * comparators `>=` `>` `<=` `<` `=`, and space-separated conjunctions of those. A range outside
 * that grammar satisfies nothing, which the resolution reports rather than guesses at.
 */
export function satisfies(version: string, range: string | undefined): boolean {
  const r = (range ?? "*").trim();
  if (r === "" || r === "*" || r === "latest" || r === "x") return true;
  const v = parseVersion(version);
  if (v === null) return false;
  return r.split(/\s+/).every((part) => {
    const m = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(part);
    if (m === null) return false;
    const op = m[1] ?? "=";
    const base = parseVersion(m[2]!);
    if (base === null) return false;
    const cmp = compareVersions(version, m[2]!);
    // A prerelease satisfies only a range that names a prerelease of the same version.
    if (v.pre !== "" && (base.pre === "" || v.nums.join(".") !== base.nums.join("."))) return false;
    switch (op) {
      case "=":
        return cmp === 0;
      case ">=":
        return cmp >= 0;
      case ">":
        return cmp > 0;
      case "<=":
        return cmp <= 0;
      case "<":
        return cmp < 0;
      case "~":
        return cmp >= 0 && v.nums[0] === base.nums[0] && v.nums[1] === base.nums[1];
      case "^": {
        if (cmp < 0) return false;
        const [M, m2] = base.nums;
        if (M !== 0) return v.nums[0] === M;
        if (m2 !== 0) return v.nums[0] === 0 && v.nums[1] === m2;
        return v.nums.join(".") === base.nums.join(".");
      }
      default:
        return false;
    }
  });
}

/**
 * The entry an install of `name` takes, or why there is none: with `integrity`, that content;
 * otherwise the highest version `version` admits, the earlier source first among equal
 * versions (`entries` is in precedence order, so a copy already on this machine wins). An
 * entry without an integrity is never taken — a fetched copy could not be checked — and is
 * named when it is all there is.
 */
export function pickIndexEntry(
  entries: readonly PluginIndexEntry[],
  name: string,
  ask: { version?: string; integrity?: string },
): PluginIndexEntry | { refused: string } {
  const listed = entries.filter((e) => e.name === name);
  if (listed.length === 0) {
    return { refused: `'${name}' is in none of the plugin index's sources` };
  }
  const fits = listed.filter(
    (e) =>
      satisfies(e.version, ask.version) &&
      (ask.integrity === undefined || e.integrity === ask.integrity),
  );
  const wanted = ask.integrity ?? ask.version ?? "*";
  if (fits.length === 0) {
    return {
      refused: `no listed '${name}' satisfies ${wanted} (listed: ${listed.map((e) => e.version).join(", ")})`,
    };
  }
  // Array.prototype.sort is stable: among equal versions the earlier source stays first.
  const best = fits
    .filter((e) => e.integrity !== undefined)
    .sort((a, b) => compareVersions(b.version, a.version))[0];
  if (best === undefined) {
    return {
      refused: `'${name}' ${wanted} is listed without an integrity, so a fetched copy could not be checked: it cannot be installed`,
    };
  }
  return best;
}
