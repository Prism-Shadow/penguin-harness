/**
 * The facts shown about a bound audio or video file: its format, size, length, bitrate and,
 * for video, its dimensions. Pure, so the arithmetic and the "still measuring" versus
 * "cannot be known" distinction are testable without a DOM.
 *
 * Every value is `undefined` while it is still being found out and `null` once it is known
 * that it cannot be, so the view can say "measuring" or show a dash rather than guess.
 */
import type { AssetManifest, MediaStat, UploadedMedia } from "@prismshadow/penguin-server/api";

export type FormatKey = "wav" | "mp3" | "ogg" | "mp4" | "webm" | "other";

/** What is known of the file itself: from the upload listing or the server's media stats. */
export interface FileFacts {
  bytes: number | null;
  mimeType: string | null;
}

/** What the browser measured by loading the file's metadata. */
export interface MeasuredFacts {
  seconds?: number | null;
  width?: number | null;
  height?: number | null;
}

export interface MediaDetails {
  format: FormatKey | null | undefined;
  bytes: number | null | undefined;
  seconds: number | null | undefined;
  kbps: number | null | undefined;
  width: number | null | undefined;
  height: number | null | undefined;
}

/** Average bitrate in kilobits a second, or null when either input is missing. */
export function bitrateKbps(
  bytes: number | null | undefined,
  seconds: number | null | undefined,
): number | null {
  if (bytes == null || seconds == null) return null;
  if (!Number.isFinite(bytes) || !Number.isFinite(seconds) || bytes < 0 || seconds <= 0)
    return null;
  return Math.round((bytes * 8) / seconds / 1000);
}

/** `m:ss.s` under an hour, `h:mm:ss.s` from an hour on; empty for a length that is not one. */
export function formatLength(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "";
  const tenths = Math.round(seconds * 10);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor((tenths % 36000) / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The dictionary key naming a content type's format. */
export function formatName(mimeType: string): FormatKey {
  const type = mimeType.split(";")[0]!.trim().toLowerCase();
  switch (type) {
    case "audio/wav":
    case "audio/wave":
    case "audio/x-wav":
    case "audio/vnd.wave":
      return "wav";
    case "audio/mpeg":
    case "audio/mp3":
      return "mp3";
    case "audio/ogg":
    case "video/ogg":
    case "application/ogg":
      return "ogg";
    case "video/mp4":
    case "audio/mp4":
      return "mp4";
    case "video/webm":
    case "audio/webm":
      return "webm";
    default:
      return "other";
  }
}

/**
 * The file facts for the asset bound to `path`.
 *
 * An upload's own listing is exact whatever state the draft is in. Otherwise the server's
 * stats describe the saved binding, so they only apply while the asset is still bound to
 * the path that was saved. `stats` is undefined while they load and null when they failed.
 */
export function fileFactsFor({
  path,
  language,
  assetKey,
  uploads,
  stats,
  saved,
}: {
  path: string;
  language: string;
  assetKey: string;
  uploads: readonly UploadedMedia[];
  stats: readonly MediaStat[] | null | undefined;
  saved: AssetManifest | undefined;
}): FileFacts | null | undefined {
  const upload = uploads.find((entry) => entry.path === path);
  if (upload) return { bytes: upload.byteLength, mimeType: upload.mimeType || null };
  const savedPath = saved?.assets[language]?.find((entry) => entry.key === assetKey)?.path;
  if (savedPath !== path) return null;
  if (stats === undefined) return undefined;
  const stat = stats?.find((entry) => entry.language === language && entry.key === assetKey);
  if (!stat) return null;
  return { bytes: stat.bytes, mimeType: stat.mimeType ?? null };
}

/** Both known, or null when either cannot be; undefined while either is still measuring. */
function combine<T>(
  a: number | null | undefined,
  b: number | null | undefined,
  make: (a: number, b: number) => T | null,
): T | null | undefined {
  if (a === null || b === null) return null;
  if (a === undefined || b === undefined) return undefined;
  return make(a, b);
}

export function detailsFor(
  file: FileFacts | null | undefined,
  measured: MeasuredFacts,
): MediaDetails {
  const format = file === undefined ? undefined : file?.mimeType ? formatName(file.mimeType) : null;
  const bytes = file === undefined ? undefined : (file?.bytes ?? null);
  const seconds =
    measured.seconds === undefined
      ? undefined
      : measured.seconds !== null && Number.isFinite(measured.seconds) && measured.seconds > 0
        ? measured.seconds
        : null;
  return {
    format,
    bytes,
    seconds,
    kbps: combine(bytes, seconds, bitrateKbps),
    width: measured.width === undefined ? undefined : measured.width || null,
    height: measured.height === undefined ? undefined : measured.height || null,
  };
}
