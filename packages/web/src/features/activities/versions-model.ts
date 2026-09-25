/**
 * Pure helpers behind the Versions table: the rows it shows, and how a version's kind and
 * media size read. Strings are read when called, so a language switch takes effect.
 */
import type { VersionSaveResult, VersionSummary } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { fileSizeText } from "./media-library";
import type { Announcement } from "./run-toasts";

export const VERSION_NAME_MAX = 80;

export interface VersionRow {
  versionId: string;
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
