/**
 * The saved versions of an activity, as the App lists them. Type-only, so the web client can
 * import it without pulling the version store into its type graph.
 */

/**
 * How a version came to be: saved by an author, kept automatically before something that
 * replaces a lot at once, written by a restore, or recorded at a deploy.
 */
export type VersionKind = "manual" | "auto" | "restore" | "deploy";

/** Why an automatic version was kept. */
export type VersionReason = "before_restore" | "before_proposal";

export interface VersionSummary {
  versionId: string;
  /** 1 for the activity's first version, counting up; never reused. */
  seq: number;
  /** The name an author gave it, or null. */
  label: string | null;
  kind: VersionKind;
  /** Set on automatic versions only. */
  reason: VersionReason | null;
  createdAt: string;
  /** The user who saved it, or null for one no user saved. */
  author: string | null;
  /** Total size of the media files the version holds (generated and uploaded). */
  mediaBytes: number;
  /** Whether the draft as it is now holds exactly this version's content. */
  current: boolean;
  /** When this version last went to QA and to PROD, or null for never. */
  deployed: { qa: string | null; prod: string | null };
}

/** What saving a version answers: the version, and whether this save made it. */
export interface VersionSaveResult {
  version: VersionSummary;
  /** False when nothing changed since the latest version, which is returned instead. */
  created: boolean;
}

/** The parts of an activity a compare shows as text, in the order it shows them. */
export type VersionFileName =
  "description" | "spec" | "mediaPlan" | "configuration" | "assessment" | "features";

/**
 * One part that differs. `before` is the compared version's text and `after` the other
 * side's; null means that side has none. JSON is pretty-printed with sorted keys.
 */
export interface VersionFileDiff {
  name: VersionFileName;
  before: string | null;
  after: string | null;
}

/** A media file that differs; a side without the file has null bytes. */
export interface VersionMediaDiff {
  /** Relative to the draft workspace. */
  path: string;
  change: "added" | "removed" | "changed";
  beforeBytes: number | null;
  afterBytes: number | null;
}

/** What differs between a version and the current draft or another version. */
export interface VersionDiff {
  /** Only the parts that differ. */
  files: VersionFileDiff[];
  /** Only the media files that differ, by path. */
  media: VersionMediaDiff[];
}

/**
 * Where a deploy target stands against the draft: never deployed, holding exactly what the
 * draft holds now, or holding something the draft has changed since.
 */
export type DeployDrift = "never" | "in_sync" | "changed";

/** The version that last went to a target, and when. */
export interface DeployedVersion {
  versionId: string;
  seq: number;
  deployedAt: string;
}

/** How QA and PROD compare with the draft as it is now. */
export interface VersionStatus {
  qa: DeployDrift;
  prod: DeployDrift;
  /** The version QA last got; null when it never got one. */
  qaVersion: DeployedVersion | null;
  /** Likewise for PROD. */
  prodVersion: DeployedVersion | null;
}
