/**
 * The published plugin index's pure readers: what one row of an `index.json` document is, how a
 * document is checked, which release channel a row installs from, and which of a package's rows
 * is the newest. No Node dependency and no state, so the server's registries
 * (packages/server/src/plugin/registry.ts) and the website's build (packages/landing) read the
 * index by the same rules: a row the App would refuse never reaches the site's catalog.
 */

/** One place a version's release asset is served from (`github`: a release asset tarball). */
export interface IndexDocumentChannel {
  kind: string;
  url: string;
}

/**
 * One row of an index document: a flat array of per-version entries, the schema of
 * typst/packages' `index.json`. Its icon, when it has one, is raw SVG text; only the index
 * embedded in the server keeps one (see parsePluginIndex).
 */
export interface IndexDocumentEntry {
  /** Package specifier — the string a Project's plugin list names. */
  name: string;
  title?: string;
  titleZh?: string;
  version: string;
  description: string;
  descriptionZh?: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
  icon?: string;
  authors: string[];
  /** SPDX license identifier. */
  license: string;
  repository?: string;
  homepage?: string;
  keywords?: string[];
  categories?: string[];
  /** Unix timestamp (seconds) of the entry's last update. */
  updatedAt?: number;
  /** `sha512-<base64>` of the tarball the row's channel serves. */
  integrity?: string;
  channels?: IndexDocumentChannel[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

/** Validates one raw entry; returns null instead of throwing so the caller can name the index position. */
function asIndexEntry(value: unknown): IndexDocumentEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const e = value as Record<string, unknown>;
  if (
    typeof e.name !== "string" ||
    typeof e.version !== "string" ||
    typeof e.description !== "string" ||
    !isStringArray(e.authors) ||
    typeof e.license !== "string"
  ) {
    return null;
  }
  for (const key of [
    "title",
    "titleZh",
    "repository",
    "homepage",
    "descriptionZh",
    "shortDescription",
    "shortDescriptionZh",
    "icon",
  ] as const) {
    if (e[key] !== undefined && typeof e[key] !== "string") return null;
  }
  for (const key of ["keywords", "categories"] as const) {
    if (e[key] !== undefined && !isStringArray(e[key])) return null;
  }
  if (e.updatedAt !== undefined && typeof e.updatedAt !== "number") return null;
  // The release pin and its channels ride the row like any other field: an index that
  // carries them is malformed when they are not well-formed, and the install face
  // decides what a well-formed row's channel is worth (indexChannelOf, below).
  if (
    e.integrity !== undefined &&
    (typeof e.integrity !== "string" || !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(e.integrity))
  ) {
    return null;
  }
  if (e.channels !== undefined) {
    if (!Array.isArray(e.channels)) return null;
    for (const channel of e.channels) {
      if (typeof channel !== "object" || channel === null) return null;
      const c = channel as Record<string, unknown>;
      if (typeof c.kind !== "string" || c.kind === "" || typeof c.url !== "string") return null;
    }
  }
  // Only the serving machine can report an installed version, even when the index is self-hosted.
  if ("localInstall" in e) {
    const { localInstall: _localOnly, ...entry } = e;
    return entry as unknown as IndexDocumentEntry;
  }
  return value as IndexDocumentEntry;
}

/**
 * Validates a whole index document. Strict, not per-entry-tolerant: an index is one
 * publisher's single artifact, so a malformed row means the artifact is broken —
 * unlike a Project's plugin list, whose entries are independent choices skipped one
 * by one.
 *
 * `icons: "drop"` is for a document from the network: the server would serve an entry's icon
 * as an image of its own, so a remote entry's is removed. Removed rather than refused — the
 * rest of the row still lists, under the puzzle piece.
 */
export function parsePluginIndex(
  data: unknown,
  source: string,
  { icons = "keep" }: { icons?: "keep" | "drop" } = {},
): IndexDocumentEntry[] {
  if (!Array.isArray(data)) {
    throw new Error(`plugin index from ${source} is not an array`);
  }
  return data.map((raw, i) => {
    const entry = asIndexEntry(raw);
    if (entry === null) {
      throw new Error(`plugin index from ${source} has a malformed entry at index ${i}`);
    }
    return icons === "drop" ? withoutIcon(entry) : entry;
  });
}

/** An index entry with no `icon`: what a remote source's entry becomes (see parsePluginIndex). */
export function withoutIcon(entry: IndexDocumentEntry): IndexDocumentEntry {
  if (!("icon" in entry)) return entry;
  const { icon: _dropped, ...rest } = entry;
  return rest;
}

/** An index entry's github channel, as the install face installs it: pinned bytes at a URL. */
export interface IndexChannel {
  name: string;
  version: string;
  integrity: string;
  url: string;
  /**
   * The same asset behind this source's CDN mirrors, tried in order when `url` is
   * unreachable; absent when the deployment carries no rewrite rules for it.
   */
  mirrors?: string[];
}

/**
 * What an entry's github channel is worth for an install: the channel when the entry pins
 * its asset and the channel is one the install face fetches; a `fault` sentence when a
 * channel is listed but the row does not pin it (there is nothing to verify against —
 * the refusal says so rather than installing unverified bytes); channel null without a
 * fault when the entry simply has no github channel (the caller's npm error stands).
 */
export function indexChannelOf(entry: IndexDocumentEntry): {
  channel: IndexChannel | null;
  fault: string | null;
} {
  const listed = entry.channels?.find((c) => c.kind === "github");
  if (listed === undefined) return { channel: null, fault: null };
  if (entry.integrity === undefined) {
    return {
      channel: null,
      fault: `${entry.name}'s index entry lists a github release channel but pins no sha512 integrity, so its bytes cannot be verified; it is not installable.`,
    };
  }
  // Plain http is refused everywhere but the loopback: a self-hosted index on this very
  // machine serves its assets locally too, and the sha512 the entry pins is what actually
  // guards the bytes — a man in the middle on any http hop cannot make a tampered tarball
  // match. Off the machine the channel is https, no exceptions.
  if (
    !listed.url.startsWith("https://") &&
    !/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])([:/]|$)/.test(listed.url)
  ) {
    return {
      channel: null,
      fault: `${entry.name}'s github channel is not an https link; it is not installable.`,
    };
  }
  return {
    channel: {
      name: entry.name,
      version: entry.version,
      integrity: entry.integrity,
      url: listed.url,
    },
    fault: null,
  };
}

/**
 * Where the published plugin index lives.
 *
 * A release asset, not the GitHub API and not a Pages URL. The API would cost a server two
 * requests against an unauthenticated 60/hour budget shared by every deployment behind one NAT,
 * for a document that changes four times a day; the asset is a plain file download with no such
 * budget, and the CDN in front of it is the same one that serves the installers.
 *
 * The tag is fixed and never re-pointed. What a six-hourly workbench in the index repository
 * replaces is the ASSET on that release, so this URL is stable for the life of the tag and
 * nothing here has to discover which release is newest — "latest nightly" is a name, resolved
 * by the publisher rather than by a search.
 */
export const NIGHTLY_INDEX_URL =
  "https://github.com/Prism-Shadow/penguin-harness-plugins/releases/download/nightly/index.json";

/** A parsed semver: the numeric core and the prerelease identifiers, `null` when there are none. */
interface ParsedSemver {
  core: [number, number, number];
  pre: string[] | null;
}

const SEMVER =
  /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

function parseSemver(version: string): ParsedSemver | null {
  const match = SEMVER.exec(version);
  if (match === null) return null;
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    pre: match[4] === undefined ? null : match[4].split("."),
  };
}

/** Whether the version parses as a semver at all (a row whose version does not is unranked). */
export function isSemver(version: string): boolean {
  return parseSemver(version) !== null;
}

/**
 * SemVer 2.0.0 precedence (semver.org §11), negative when `a` ranks below `b`, positive above,
 * zero when equivalent: the numeric core first; then a prerelease ranks BELOW the release it
 * belongs to (`0.0.1-alpha.2 < 0.0.1`), its dot-separated identifiers compare left to right —
 * numeric identifiers by value (`alpha.2 < alpha.10`, the trap a string compare falls into),
 * alphanumeric by ASCII (`alpha < beta`), numeric below alphanumeric — and a shorter prerelease
 * that matches so far ranks lower (`alpha < alpha.1`). Build metadata never takes part:
 * `1.0.0+x` and `1.0.0+y` are equivalent. Both versions must parse (`isSemver`); one that does
 * not throws — the caller gates on `isSemver` first.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left === null) throw new Error(`not a semver: ${a}`);
  if (right === null) throw new Error(`not a semver: ${b}`);
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i]! - right.core[i]!;
  }
  if (left.pre === null && right.pre === null) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  const shared = Math.min(left.pre.length, right.pre.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left.pre[i]!;
    const y = right.pre[i]!;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      if (x !== y) return Number(x) - Number(y);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return left.pre.length - right.pre.length;
}

/** Whether version `a` outranks `b` for the same package: a semver outranks a non-semver, two non-semvers keep the first, two semvers go by precedence (equal keeps the first). */
function outranks(a: string, b: string): boolean {
  const parsedA = isSemver(a);
  const parsedB = isSemver(b);
  if (parsedA !== parsedB) return parsedA;
  if (!parsedA) return false;
  return compareSemver(a, b) > 0;
}

/**
 * The newest row per package name: of a document's several rows for one package — the format is
 * a flat array of per-version entries — the one a consumer would want. The winner is the highest
 * SemVer 2.0.0 precedence (see compareSemver for what that means for prereleases); a row whose
 * version does not parse as semver loses to any row that does, and keeps the document's first
 * among themselves; rows of equal precedence (a build-metadata difference) keep the first. The
 * survivors come back in the document's own order.
 */
export function newestPerName(entries: readonly IndexDocumentEntry[]): IndexDocumentEntry[] {
  const newest = new Map<string, IndexDocumentEntry>();
  for (const entry of entries) {
    const held = newest.get(entry.name);
    if (held === undefined || outranks(entry.version, held.version)) newest.set(entry.name, entry);
  }
  return entries.filter((entry) => newest.get(entry.name) === entry);
}
