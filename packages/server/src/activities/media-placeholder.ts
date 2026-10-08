/**
 * Loom's placeholder media, seeded into the media repository wherever a video or animation is
 * bound to it (see placeholderPath). The files ship beside this module: in the source tree
 * and, through scripts/media-placeholder-assets.mjs, beside every bundle.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { MediaAsset, PlaceholderType } from "./media.js";
import { hasPlaceholder, placeholderPath } from "./media.js";
import { mediaFile } from "./ref-media.js";
import type { ActivityAddress } from "./domain.js";

const PLACEHOLDERS: Record<PlaceholderType, URL> = {
  video: new URL("./video-placeholder.mp4", import.meta.url),
  animation: new URL("./animation-placeholder.json", import.meta.url),
};

/**
 * Writes the placeholder at each placeholder path the manifest binds, where it is missing.
 * An existing file is left alone: it is the same placeholder, or a file someone put there.
 */
export async function seedMediaPlaceholders(
  wafRoot: string,
  address: ActivityAddress,
  assets: Record<string, MediaAsset[]>,
): Promise<void> {
  const targets = new Map<string, PlaceholderType>();
  for (const [language, group] of Object.entries(assets))
    for (const asset of group)
      if (
        hasPlaceholder(asset.type) &&
        asset.path === placeholderPath(address, language, asset.type)
      )
        targets.set(asset.path, asset.type);
  for (const [reference, type] of targets) {
    const file = mediaFile(wafRoot, reference);
    if (!file) continue;
    await fs.mkdir(path.dirname(file), { recursive: true });
    try {
      await fs.copyFile(PLACEHOLDERS[type], file, fs.constants.COPYFILE_EXCL);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}
