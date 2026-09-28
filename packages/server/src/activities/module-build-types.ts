/**
 * The module builds of an activity as the App lists and compares them: one per succeeded
 * assembly run. Type-only, so the web client can import it without the build service.
 */

/** One succeeded assembly, newest first in a list. */
export interface ModuleBuild {
  runId: string;
  createdAt: string;
  finishedAt: string | null;
  /** How many source files the build holds; null when its folder is gone. */
  files: number | null;
  /** Whether this is the newest build, which the preview plays unless another is pinned. */
  newest: boolean;
}

export interface ModuleBuildList {
  /** Newest first. */
  builds: ModuleBuild[];
  /** The build an author pinned for the preview, or null. */
  pinnedRunId: string | null;
  /**
   * The build the preview plays: the pinned one while it is still a succeeded build, else
   * the newest; null with no build.
   */
  playingRunId: string | null;
}

/** How a file compares between two builds, going from `from` to `to`. */
export type ModuleBuildChange = "added" | "removed" | "changed";

/**
 * Whether a changed file's text is included: yes, no because it is not a text file the
 * compare reads, or no because a side is larger than the compare reads.
 */
export type ModuleBuildText = "shown" | "binary" | "too_large";

export interface ModuleBuildFileDiff {
  /** Relative to the module folder, with forward slashes. */
  path: string;
  change: ModuleBuildChange;
  beforeBytes: number | null;
  afterBytes: number | null;
  text: ModuleBuildText;
  /** The `from` build's text when shown; null when not shown or that side has no file. */
  before: string | null;
  /** The `to` build's text, likewise. */
  after: string | null;
}

/** What differs between two builds' source files. */
export interface ModuleBuildDiff {
  from: string;
  to: string;
  /** Only the files that differ, by path. */
  files: ModuleBuildFileDiff[];
  /** How many files the two builds hold alike. */
  unchanged: number;
}
