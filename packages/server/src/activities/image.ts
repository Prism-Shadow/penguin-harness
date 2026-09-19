import fs from "node:fs/promises";
import path from "node:path";
import { contentRevision, type ActivityDetail } from "./domain.js";
import { readArtifactBytes } from "./artifact.js";
import { findWafRoot } from "./waf-module.js";
import { HttpError } from "../http/errors.js";

export interface ImageRequest {
  language: string;
  assetKey: string;
  expectedRevision: string;
  wafRoot?: string;
}

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;

/** Only raster formats: SVG and HTML never become same-origin executable documents. */
export function imageMime(bytes: Buffer): string {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    bytes.toString("ascii", 12, 16) === "IHDR"
  )
    return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (bytes.length >= 13 && ["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6)))
    return "image/gif";
  if (
    bytes.length >= 20 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP" &&
    bytes.readUInt32LE(4) === bytes.length - 8
  )
    return "image/webp";
  throw new HttpError(
    415,
    "image_unsupported",
    "Image previews support PNG, JPEG, GIF and WebP files.",
  );
}

/** Resolve an activity binding, never a caller-supplied media filename. */
export async function readBoundImage(activity: ActivityDetail, input: ImageRequest) {
  if (activity.draft.contentRevision !== input.expectedRevision)
    throw new HttpError(
      409,
      "draft_conflict",
      "The draft changed. Reload it before previewing media.",
    );
  const plan = activity.draft.mediaPlan;
  if (
    !plan ||
    activity.draft.status !== "valid" ||
    plan.specRevision !== contentRevision(activity.draft.spec)
  )
    throw new HttpError(409, "media_stale", "Rebuild the media plan before previewing images.");
  const asset = plan.manifest.assets[input.language]?.find((entry) => entry.key === input.assetKey);
  if (!asset || asset.type !== "image" || !asset.path)
    throw new HttpError(404, "image_unbound", "This image has no saved media binding.");
  // Recheck even when the caller loaded a validated draft; keep this filesystem seam self-contained.
  const parts = asset.path.split("/");
  if (
    !/^media\/[A-Za-z0-9_./ -]+$/.test(asset.path) ||
    parts.some((part) => !part || part === "." || part === ".." || /[. ]$/.test(part))
  )
    throw new HttpError(400, "image_path_invalid", "The saved image path is invalid.");
  const root = await findWafRoot(undefined, input.wafRoot);
  if (!root)
    throw new HttpError(
      400,
      "waf_missing",
      "Choose a WAF checkout containing framework, modules and media.",
    );
  try {
    let file = root;
    const ancestors = [];
    let leaf;
    for (const [index, part] of parts.entries()) {
      file = path.join(file, part);
      const stat = await fs.lstat(file);
      if (
        stat.isSymbolicLink() ||
        (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())
      )
        throw new Error("Linked media is not allowed.");
      ancestors.push({ file, stat });
      leaf = stat;
    }
    const bytes = await readArtifactBytes(file, IMAGE_MAX_BYTES, leaf);
    // A directory moved or replaced while reading must not publish its bytes.
    for (const ancestor of ancestors) {
      const stat = await fs.lstat(ancestor.file);
      if (stat.isSymbolicLink() || stat.dev !== ancestor.stat.dev || stat.ino !== ancestor.stat.ino)
        throw new Error("Media changed during the read.");
    }
    return { bytes, mimeType: imageMime(bytes) };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      404,
      "image_unavailable",
      "Image unavailable. Check its saved path, file size (8 MiB maximum), and WAF checkout. Linked files are not supported.",
    );
  }
}
