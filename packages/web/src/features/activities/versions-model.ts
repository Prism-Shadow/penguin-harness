/**
 * Pure helpers behind the Versions table: the rows it shows, how a version's kind and media
 * size read, what a compare shows, and what a refused restore says. Strings are read when
 * called, so a language switch takes effect.
 */
import type {
  VersionDiff,
  VersionFileName,
  VersionSaveResult,
  VersionSummary,
} from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { fileSizeText } from "./media-library";
import type { Announcement } from "./run-toasts";

export const VERSION_NAME_MAX = 80;

export interface VersionRow {
  versionId: string;
  seq: number;
  number: string;
  name: string | null;
  kind: string;
  createdAt: string;
  author: string;
  size: string;
  current: boolean;
}

/** What made a version, with the reason an automatic one was kept. */
export function kindText(version: Pick<VersionSummary, "kind" | "reason">): string {
  const kind = S.activities.versions.kinds[version.kind] ?? version.kind;
  const reason = version.reason ? S.activities.versions.reasons[version.reason] : undefined;
  return reason ? `${kind} · ${reason}` : kind;
}

/** How much media a version holds; a version with none says so rather than "0 B". */
export function sizeText(bytes: number): string {
  return bytes > 0 ? fileSizeText(bytes) : S.activities.versions.noMedia;
}

/** Newest first, whatever order the list arrived in. */
export function versionRows(list: readonly VersionSummary[]): VersionRow[] {
  return [...list]
    .sort((a, b) => b.seq - a.seq)
    .map((version) => ({
      versionId: version.versionId,
      seq: version.seq,
      number: S.activities.versions.number(version.seq),
      name: version.label,
      kind: kindText(version),
      createdAt: version.createdAt,
      author: version.author ?? S.activities.versions.noAuthor,
      size: sizeText(version.mediaBytes),
      current: version.current,
    }));
}

/**
 * The name to send: trimmed, null when empty, or a problem to show beside the field. The
 * server trims and checks the same way.
 */
export function versionName(text: string): { name: string | null; problem: string | null } {
  const name = text.trim();
  if (name.length > VERSION_NAME_MAX)
    return { name: null, problem: S.activities.versions.nameTooLong(VERSION_NAME_MAX) };
  return { name: name || null, problem: null };
}

/** What to say after a save: the new version, or that nothing changed since the latest. */
export function saveAnnouncement(result: VersionSaveResult): Announcement {
  const { seq } = result.version;
  return result.created
    ? { kind: "success", text: S.activities.versions.saved(seq) }
    : { kind: "info", text: S.activities.versions.unchanged(seq) };
}

/** A compare's tab: one changed part, with the two texts its line diff reads. */
export interface CompareTab {
  key: VersionFileName;
  label: string;
  /** The version's text; empty when the version has none. */
  before: string;
  /** The current draft's text; empty when the draft has none. */
  after: string;
}

/** One tab per part that differs, in the order the server lists them. */
export function compareTabs(diff: VersionDiff): CompareTab[] {
  const files = S.activities.versions.files;
  return diff.files.map((file) => ({
    key: file.name,
    label: files[file.name] ?? file.name,
    before: file.before ?? "",
    after: file.after ?? "",
  }));
}

export interface MediaChangeRow {
  path: string;
  change: string;
  before: string;
  after: string;
}

/** The media table's rows: the change in words and each side's size, or that it has none. */
export function mediaChangeRows(diff: VersionDiff): MediaChangeRow[] {
  const words = S.activities.versions;
  const size = (bytes: number | null) => (bytes === null ? words.noFile : fileSizeText(bytes));
  return diff.media.map((file) => ({
    path: file.path,
    change: words.media[file.change] ?? file.change,
    before: size(file.beforeBytes),
    after: size(file.afterBytes),
  }));
}

/** Whether a compare found nothing to show. */
export function isSame(diff: VersionDiff): boolean {
  return diff.files.length === 0 && diff.media.length === 0;
}

/**
 * What a refused restore says when the version lacks a file: the server names the first
 * missing file as `detail.path`, or none when the version's record itself is missing. Null
 * for any other refusal, which reads as the usual error text.
 */
export function restoreProblem(
  code: string,
  detail: Readonly<Record<string, string>> | undefined,
): string | null {
  if (code !== "version_incomplete") return null;
  const file = detail?.path;
  return file ? S.activities.versions.incomplete(file) : S.activities.versions.incompleteRecord;
}
