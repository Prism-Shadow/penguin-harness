/**
 * Version-string helpers shared by everything that talks about releases: the CLI's
 * `penguin update` command and the server's update-check endpoint (the web UI's update
 * reminder). Moved here from the CLI so the server does not need a dependency on the CLI
 * package; the barrel re-exports both functions.
 */

/** Strips a leading `v` so `v0.1.2` and `0.1.2` are the same input. */
export function normalizeVersion(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

/**
 * Compares two dotted numeric versions: -1 / 0 / 1.
 *
 * Each dot-separated component is read with `Number.parseInt`, which takes the leading digits and
 * ignores the rest: `1abc` is 1, and `2-rc1` is 2. A component with no leading digit at all, or
 * one that is missing entirely, counts as 0 — which is the property that matters, because it means
 * a malformed or truncated tag can never make an upgrade look available.
 *
 * The consequence, stated rather than papered over: suffixes are invisible here, so `0.1.2-rc1`
 * compares *equal* to `0.1.2`. This project tags plain `vX.Y.Z` releases only, and the API this
 * reads (`tag_name` from GitHub Releases) returns those tags, so the case does not arise; carrying
 * a full semver precedence implementation — with its own numeric-vs-alphanumeric identifier rules
 * — to handle tags we do not publish would be more code and more ways to be wrong. If pre-release
 * tags are ever published, this has to become a real semver compare before the CLI's `--release`
 * flag can target one.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    normalizeVersion(v)
      .split(".")
      .map((n) => Number.parseInt(n, 10));
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const l = Number.isFinite(x[i]) ? (x[i] as number) : 0;
    const r = Number.isFinite(y[i]) ? (y[i] as number) : 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}
