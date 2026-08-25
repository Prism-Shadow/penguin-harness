/**
 * Identity of the running build and of this machine's harness store — what
 * `penguin version --json` prints and what GET /api/version returns.
 *
 * Deliberately not part of the interface contracts: this says nothing about the LLM or the
 * Environment, and no boundary of the agent loop carries it. Core's `buildInfo()` produces
 * the {@link BuildInfo} half; only a caller that knows which data root is in play can fill
 * the harness half.
 */

/**
 * Node and OS the build is executing on — the part of a build's identity that is a property
 * of the run rather than of the artifact.
 */
export interface BuildRuntimeInfo {
  /** `process.versions.node`. */
  node: string;
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
}

/**
 * Identity of the running build: everything `penguin version --json` prints and everything
 * GET /api/version returns. Both render this object without adding facts of their own, so a
 * report gathered over HTTP and one gathered at a shell are the same report.
 *
 * Produced by core's `buildInfo()`. Which fields carry information depends on `channel`: a
 * release knows its date and the commit it was built from, a source build knows its git
 * position instead.
 */
export interface BuildInfo {
  /** Dotted release number, from core's VERSION constant. Never null, never prefixed. */
  version: string;
  /**
   * The one-line human identity, and the whole of `penguin version`'s output: `v0.2.3` for a
   * release, and git's own description for a source build — `v0.2.3-14-g9e8f7d6-dirty` reads
   * as fourteen commits past v0.2.3, at 9e8f7d6, with uncommitted changes. Always begins
   * `v` followed by a digit, so any form reads as a version.
   *
   * Not necessarily `v{version}`: a tag description names the nearest reachable TAG, which
   * during release preparation is the previous one — `VERSION` is bumped in its own commit
   * and the new tag is created afterwards, so a build from that window truthfully reports
   * `v0.2.3-N-g…` while `version` already reads 0.2.4. Compare `version` when you mean the
   * release number and `describe` when you mean the position in history.
   */
  describe: string;
  /** `release` once the release workflow has stamped the build; `source` for every other build. */
  channel: "release" | "source";
  /** Release build date (UTC yyyy-mm-dd); null in a source build. */
  buildDate: string | null;
  /** Full commit sha this build came from; null when neither the stamp nor git supplied one. */
  commit: string | null;
  /** Branch checked out at build time; null for a release, and for a detached HEAD. */
  branch: string | null;
  /**
   * Whether tracked files differed from the commit. Null means the question does not apply
   * rather than "clean": a release stamps its constants into the tree before building, so
   * cleanliness is not a fact about release artifacts.
   */
  dirty: boolean | null;
  runtime: BuildRuntimeInfo;
}

/**
 * Where a hot update was pushed from, as the pusher recorded it. Provenance only: nothing
 * here is ever executed or resolved, and both fields are whatever the pushing client sent.
 */
export interface HarnessSource {
  /** The pushing checkout's origin remote, or its directory name when it has no remote. */
  repo: string;
  /** `git describe --tags --dirty` of the pushing checkout, spelled as {@link BuildInfo.describe}. */
  revision: string;
}

/**
 * What this machine's HMR store has committed — the harness code a hot update put there,
 * which a restart resumes. A property of the data root rather than of the running process:
 * it answers "which harness was pushed here", not "which code is executing".
 *
 * That distinction matters because the two can differ. `penguin` runs the packaged CLI
 * while `penguin-hmr` runs the store's; a server whose committed version failed to restore
 * warns and falls back to its packaged platform. Null in {@link VersionReport} means
 * nothing was ever pushed to this root.
 */
export interface HarnessInfo {
  /** Null for a version pushed by a client that recorded no provenance. */
  source: HarnessSource | null;
  /** When the version was committed to the store (ISO 8601); null if it predates the record. */
  pushedAt: string | null;
  /**
   * The committed artifacts' content-addressed pointers, relative to `<root>/hmr` — the
   * identity of the pushed code itself, independent of what the pusher claimed about it.
   */
  bundles: {
    platform: string | null;
    cli: string | null;
    web: string | null;
  };
}

/**
 * What `penguin version --json` prints and what GET /api/version returns: the running
 * build's identity, plus the harness this machine has in its HMR store.
 *
 * The two halves come from different places and neither can supply the other. {@link
 * BuildInfo} describes the artifact this process is executing and core resolves it alone;
 * `harness` describes the data root's store, so only a caller that knows which root is in
 * play can fill it.
 */
export interface VersionReport extends BuildInfo {
  harness: HarnessInfo | null;
}
