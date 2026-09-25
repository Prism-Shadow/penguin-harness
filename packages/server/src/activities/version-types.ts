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
