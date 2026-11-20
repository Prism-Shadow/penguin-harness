/**
 * Which version of a registry document an install made without npm takes (direct-install.ts),
 * by npm's own rules for the specs it reads:
 *
 * - none: the `latest` dist-tag; a dist-tag: the version it names;
 * - an exact version (`1.2.3`, `v1.2.3`, `=1.2.3`, prereleases included): that version;
 * - a caret, tilde or x-range (`^1.2.3`, `^0.2`, `~1.2.3`, `~1`, `1`, `1.x`, `1.2.*`, `*`): the
 *   highest version it admits — the `latest` dist-tag when that one is admitted, as npm picks.
 *   Caret fixes the leftmost non-zero part (`^0.2.3` is `<0.3.0`); a prerelease is admitted
 *   only when the range itself names a prerelease of the same `major.minor.patch`.
 *
 * Any other range (comparators, `||` unions, hyphen ranges) is refused with a request to name
 * a version: a guess there would install a version nobody asked for. A tag, a version or a
 * range the document does not have is "unavailable" — npm's ETARGET, which the published
 * index's channel may still answer.
 */
import { compareSemver, isSemver } from "./registry.js";

/** The parts of a registry document the pick reads. */
export interface RegistryDocument {
  versions?: Record<string, unknown>;
  "dist-tags"?: Record<string, unknown>;
}

export type VersionPick =
  | { version: string }
  | {
      fault: string;
      /** The document has no such version or tag (ETARGET); false: the spec is not one read here. */
      unavailable: boolean;
    };

/** A version with some parts left open: `1`, `1.x`, `1.2.*`, `*`; null marks an open part. */
interface Partial {
  major: number | null;
  minor: number | null;
  patch: number | null;
  pre: string | null;
}

const PARTIAL =
  /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;

function parsePartial(text: string): Partial | null {
  if (text === "" || text === "*" || text === "x" || text === "X") {
    return { major: null, minor: null, patch: null, pre: null };
  }
  const match = PARTIAL.exec(text);
  if (match === null) return null;
  const part = (value: string | undefined) =>
    value === undefined || /^[xX*]$/.test(value) ? null : Number(value);
  const major = part(match[1]);
  // An open part closes every part after it: `1.x.3` reads as `1.x`.
  const minor = major === null ? null : part(match[2]);
  const patch = minor === null ? null : part(match[3]);
  return { major, minor, patch, pre: patch === null ? null : (match[4] ?? null) };
}

/** `[floor, ceiling)` of a range; a null ceiling is unbounded, `exact` admits that version alone. */
interface Bounds {
  floor: string;
  ceiling: string | null;
  exact: boolean;
  /** The prerelease the range names, whose `major.minor.patch` admits prereleases. */
  pre: string | null;
}

const v = (major: number, minor: number, patch: number, pre: string | null = null) =>
  `${major}.${minor}.${patch}${pre === null ? "" : `-${pre}`}`;

/** The bounds a spec names; null when it is not a caret, tilde, x-range or exact version. */
function boundsOf(spec: string): Bounds | null {
  const op = spec.startsWith("^")
    ? "^"
    : spec.startsWith("~")
      ? "~"
      : spec.startsWith("=")
        ? "="
        : "";
  const p = parsePartial(spec.slice(op.length));
  if (p === null) return null;
  const { major, minor, patch, pre } = p;
  if (major === null) return { floor: "0.0.0", ceiling: null, exact: false, pre: null };
  const floor = v(major, minor ?? 0, patch ?? 0, pre);
  // The ceiling's `-0` is the lowest prerelease of that version: nothing of it is admitted.
  if (minor === null) return { floor, ceiling: v(major + 1, 0, 0, "0"), exact: false, pre };
  if (op === "^") {
    if (major > 0) return { floor, ceiling: v(major + 1, 0, 0, "0"), exact: false, pre };
    if (minor > 0 || patch === null) {
      return { floor, ceiling: v(0, minor + 1, 0, "0"), exact: false, pre };
    }
    return { floor, ceiling: v(0, 0, patch + 1, "0"), exact: false, pre };
  }
  if (op === "~" || patch === null) {
    return { floor, ceiling: v(major, minor + 1, 0, "0"), exact: false, pre };
  }
  return { floor, ceiling: null, exact: true, pre };
}

/** The `major.minor.patch` of a semver, without its prerelease or build. */
const core = (version: string) => version.split(/[-+]/, 1)[0]!;

function admits(bounds: Bounds, version: string): boolean {
  if (bounds.exact) return compareSemver(version, bounds.floor) === 0;
  if (compareSemver(version, bounds.floor) < 0) return false;
  if (bounds.ceiling !== null && compareSemver(version, bounds.ceiling) >= 0) return false;
  if (/^[^+]*-/.test(version)) {
    return bounds.pre !== null && core(version) === core(bounds.floor);
  }
  return true;
}

/** The version `spec` names in `document` (see the header). */
export function pickRegistryVersion(
  name: string,
  document: RegistryDocument,
  spec: string | undefined,
): VersionPick {
  const versions = Object.keys(document.versions ?? {}).filter(isSemver);
  const tags = document["dist-tags"] ?? {};
  const asked = spec === undefined || spec.trim() === "" ? "latest" : spec.trim();
  const listed = () =>
    versions.length === 0 ? "none" : [...versions].sort(compareSemver).slice(-8).join(", ");
  if (/[\s<>|]/.test(asked)) {
    return {
      fault: `${name} can be installed without npm by a version, a ^, ~ or x-range, or a dist-tag, not by the range ${asked}; name a version, or install Node.js so npm resolves it.`,
      unavailable: false,
    };
  }
  const bounds = boundsOf(asked);
  if (bounds === null) {
    const tagged = tags[asked];
    if (typeof tagged === "string" && versions.includes(tagged)) return { version: tagged };
    return {
      fault: `the registry has no ${JSON.stringify(asked)} tag for ${name}`,
      unavailable: true,
    };
  }
  const admitted = versions.filter((version) => admits(bounds, version));
  if (admitted.length === 0) {
    return {
      fault: `no version of ${name} matches ${asked}; the registry has ${listed()}`,
      unavailable: true,
    };
  }
  const latest = tags.latest;
  if (typeof latest === "string" && admitted.includes(latest)) return { version: latest };
  return { version: admitted.reduce((a, b) => (compareSemver(b, a) > 0 ? b : a)) };
}

/**
 * What npm records in the prefix's package.json for a registry install of `version` asked for
 * as `spec`: `^<version>` (npm's save prefix) for no spec, a tag or an exact version, and for
 * a range that `^<version>` stays inside; the range itself otherwise (`~1.2.0` stays `~1.2.0`,
 * since `^1.2.5` would admit versions it does not).
 */
export function savedRange(spec: string | undefined, version: string): string {
  const caret = `^${version}`;
  const asked = spec === undefined ? "" : spec.trim();
  const bounds = asked === "" ? null : boundsOf(asked);
  if (bounds === null || bounds.exact) return caret;
  const own = boundsOf(caret)!;
  const inside =
    bounds.ceiling === null ||
    (own.ceiling !== null && compareSemver(own.ceiling, bounds.ceiling) <= 0);
  return inside ? caret : asked;
}
