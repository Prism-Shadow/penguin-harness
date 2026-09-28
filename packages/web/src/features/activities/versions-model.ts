/**
 * Pure helpers behind the Versions table: the rows it shows, how a version's kind and media
 * size read, what a compare shows, and what a refused restore says. Strings are read when
 * called, so a language switch takes effect.
 */
import type {
  VersionDiff,
  VersionFileName,
  VersionSaveResult,
  VersionStatus,
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
  /** Where the version went, QA first; empty for one never deployed. */
  deployed: DeployedBadge[];
}

export interface DeployedBadge {
  target: "qa" | "prod";
  /** What the badge shows. */
  label: string;
  /** Its accessible name: where the version went, and when. */
  name: string;
}

/** How a time reads in the table: the viewer's own date and time. */
export const localTime = (iso: string) => new Date(iso).toLocaleString();

/** The QA and PROD badges of a version that went there. */
export function deployedBadges(
  version: Pick<VersionSummary, "deployed">,
  when: (iso: string) => string = localTime,
): DeployedBadge[] {
  const words = S.activities.versions;
  return (["qa", "prod"] as const).flatMap((target) => {
    const at = version.deployed?.[target];
    if (!at) return [];
    const label = words.deployedBadge[target];
    return [{ target, label, name: words.deployedOn(label, when(at)) }];
  });
}

/** One line of the deploy status: the words, the tone they read in, and which version went. */
export interface StatusLine {
  target: "qa" | "prod";
  text: string;
  tone: "success" | "attention" | "muted";
  /** The version that went and when; null when none went. */
  detail: string | null;
}

const DRIFTS = new Set(["never", "in_sync", "changed"]);

/** Whether an answer is a deploy status the App can word. */
export function isVersionStatus(value: unknown): value is VersionStatus {
  const status = value as Partial<VersionStatus> | null;
  return (
    !!status &&
    typeof status === "object" &&
    DRIFTS.has(status.qa as string) &&
    DRIFTS.has(status.prod as string)
  );
}

/** QA's and PROD's status against the draft, QA first. */
export function statusLines(
  status: VersionStatus,
  when: (iso: string) => string = localTime,
): StatusLine[] {
  const words = S.activities.versions.status;
  return (["qa", "prod"] as const).map((target) => {
    const drift = status[target];
    const version = target === "qa" ? status.qaVersion : status.prodVersion;
    return {
      target,
      text: words[target][drift] ?? drift,
      tone: drift === "in_sync" ? "success" : drift === "changed" ? "attention" : "muted",
      detail: version ? words.deployed(version.seq, when(version.deployedAt)) : null,
    };
  });
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
      deployed: deployedBadges(version),
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
