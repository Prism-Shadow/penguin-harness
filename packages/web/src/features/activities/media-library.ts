/**
 * Pure helpers behind the activity media library: which uploads a given scene asset
 * may be bound to, how they are searched and ordered, and what the file picker will
 * accept. The server sniffs every upload's real format, so a kind here is a fact
 * about the bytes rather than about the name.
 */

import type { UploadedMedia, UploadKind } from "@prismshadow/penguin-server/api";
import type { SceneAssetType } from "./scene-assets";

/**
 * An animation is authored as a video file, so both scene types draw from the same
 * uploads. Nothing else crosses.
 */
export function uploadKindFor(type: SceneAssetType): UploadKind {
  return type === "image" ? "image" : type === "audio" ? "audio" : "video";
}

/** What the file picker offers, so an author is not shown files the server will reject. */
export const UPLOAD_ACCEPT: Record<UploadKind, string> = {
  image: "image/png,image/jpeg,image/gif,image/webp",
  audio: "audio/wav,audio/mpeg,audio/ogg",
  video: "video/mp4,video/webm",
};

/** The uploads one scene asset can be bound to, newest first, narrowed by a search. */
export function libraryMatches(
  media: readonly UploadedMedia[],
  type: SceneAssetType,
  query: string,
): UploadedMedia[] {
  const kind = uploadKindFor(type);
  const needle = query.trim().toLowerCase();
  return media
    .filter((entry) => entry.kind === kind)
    .filter((entry) => !needle || entry.name.toLowerCase().includes(needle))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

/** A file size an author can read at a glance. */
export function fileSizeText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** The upload a binding points at, if the binding is an upload at all. */
export function boundUpload(
  media: readonly UploadedMedia[],
  path: string | undefined,
): UploadedMedia | undefined {
  return path ? media.find((entry) => entry.path === path) : undefined;
}

/** Whether a binding is served from this activity's workspace rather than the checkout. */
export function isUploadPath(path: string | undefined): boolean {
  return !!path && path.startsWith("media/uploads/");
}
