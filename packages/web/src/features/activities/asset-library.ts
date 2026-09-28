/**
 * The Asset Library's model: every asset the media plan asks for, and every file uploaded
 * for the activity, each with what connects it to the other. Kept pure so the filters and
 * the "used by" counts are the same wherever they are read.
 */
import type { AssetManifest, UploadedMedia } from "@prismshadow/penguin-server/api";
import { isUploadPath } from "./media-library";

type MediaAsset = AssetManifest["assets"][string][number];

export type LibraryKind = "all" | MediaAsset["type"];
export type LibraryBinding = "any" | "unbound" | "bound";

export interface PlannedEntry {
  key: string;
  type: MediaAsset["type"];
  description: string;
  path: string | null;
  /** Where the bound file came from, or null while nothing is bound. */
  source: "generated" | "upload" | "checkout" | null;
  sceneIds: string[];
}

export interface UploadEntry {
  upload: UploadedMedia;
  /** The planned assets bound to this file, in manifest order. */
  usedBy: string[];
}

export function plannedEntries(assets: readonly MediaAsset[]): PlannedEntry[] {
  return assets.map((asset) => ({
    key: asset.key,
    type: asset.type,
    description: asset.description,
    path: asset.path ?? null,
    source: !asset.path
      ? null
      : asset.generatedAudio || asset.generatedImage || asset.generatedVideo
        ? "generated"
        : isUploadPath(asset.path)
          ? "upload"
          : "checkout",
    sceneIds: [...new Set(asset.usages.map((usage) => usage.sceneId))],
  }));
}

export function uploadEntries(
  uploads: readonly UploadedMedia[],
  assets: readonly MediaAsset[],
): UploadEntry[] {
  return uploads.map((upload) => ({
    upload,
    usedBy: assets.filter((asset) => asset.path === upload.path).map((asset) => asset.key),
  }));
}

const matches = (query: string, ...fields: string[]) => {
  const wanted = query.trim().toLowerCase();
  return !wanted || fields.some((field) => field.toLowerCase().includes(wanted));
};

export function filterPlanned(
  entries: readonly PlannedEntry[],
  kind: LibraryKind,
  binding: LibraryBinding,
  query: string,
): PlannedEntry[] {
  return entries.filter(
    (entry) =>
      (kind === "all" || entry.type === kind) &&
      (binding === "any" || (binding === "bound") === !!entry.path) &&
      matches(query, entry.key, entry.description, entry.path ?? "", ...entry.sceneIds),
  );
}

export function filterUploads(
  entries: readonly UploadEntry[],
  kind: LibraryKind,
  binding: LibraryBinding,
  query: string,
): UploadEntry[] {
  return entries.filter(
    (entry) =>
      (kind === "all" || entry.upload.kind === kind) &&
      (binding === "any" || (binding === "bound") === entry.usedBy.length > 0) &&
      matches(query, entry.upload.name, entry.upload.path, ...entry.usedBy),
  );
}
