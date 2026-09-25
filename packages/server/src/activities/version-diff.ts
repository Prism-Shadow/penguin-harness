/**
 * What differs between two version manifests: each part of the draft as text, and the media
 * files by path. Pure, so the compare reads the same whether one side is a stored version or
 * the draft as it is now.
 */
import { canonical } from "./domain.js";
import type { VersionManifest, VersionMedia } from "./version-manifest.js";
import type {
  VersionDiff,
  VersionFileDiff,
  VersionFileName,
  VersionMediaDiff,
} from "./version-types.js";

/** JSON with sorted keys and two-space indents, or null for nothing. */
function pretty(value: unknown): string | null {
  return value === null || value === undefined ? null : JSON.stringify(canonical(value), null, 2);
}

/** Each part of the draft a compare shows, as the text it compares. */
export function versionTexts(manifest: VersionManifest): Record<VersionFileName, string | null> {
  const { draft } = manifest;
  return {
    description: draft.description,
    spec: pretty(draft.spec),
    mediaPlan: pretty(draft.mediaPlan),
    configuration: pretty(draft.moduleDocuments?.configuration?.value),
    assessment: pretty(draft.moduleDocuments?.assessment?.value),
    features: pretty(manifest.implementationFeatures),
  };
}

const ORDER: readonly VersionFileName[] = [
  "description",
  "spec",
  "mediaPlan",
  "configuration",
  "assessment",
  "features",
];

/**
 * A version's files by what they are for. A generated clip or image is known by the asset it
 * was made for, so one generated again under a new run reads as that asset's file changing;
 * any other file is known by its path.
 */
function mediaSlots(manifest: VersionManifest): Map<string, VersionMedia> {
  const byPath = new Map(manifest.media.map((file) => [file.path, file]));
  const slots = new Map<string, VersionMedia>();
  const claimed = new Set<string>();
  for (const [language, assets] of Object.entries(manifest.draft.mediaPlan?.manifest.assets ?? {}))
    for (const asset of assets) {
      const file = asset.generatedAudio
        ? byPath.get(`audio/${asset.generatedAudio.runId}.${asset.generatedAudio.format ?? "wav"}`)
        : asset.generatedImage
          ? byPath.get(`images/${asset.generatedImage.runId}.png`)
          : undefined;
      if (!file || claimed.has(file.path)) continue;
      slots.set(`asset:${language}:${asset.key}`, file);
      claimed.add(file.path);
    }
  for (const file of manifest.media)
    if (!claimed.has(file.path)) slots.set(`path:${file.path}`, file);
  return slots;
}

/** What changes going from `before` to `after`; parts and files that are equal are left out. */
export function versionDiff(before: VersionManifest, after: VersionManifest): VersionDiff {
  const left = versionTexts(before);
  const right = versionTexts(after);
  const files: VersionFileDiff[] = ORDER.filter((name) => left[name] !== right[name]).map(
    (name) => ({ name, before: left[name], after: right[name] }),
  );
  const was = mediaSlots(before);
  const now = mediaSlots(after);
  const media: VersionMediaDiff[] = [];
  for (const slot of new Set([...was.keys(), ...now.keys()])) {
    const a = was.get(slot);
    const b = now.get(slot);
    if (a && b && a.sha256 === b.sha256) continue;
    media.push({
      path: (b ?? a)!.path,
      change: !a ? "added" : !b ? "removed" : "changed",
      beforeBytes: a?.bytes ?? null,
      afterBytes: b?.bytes ?? null,
    });
  }
  media.sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
  return { files, media };
}
