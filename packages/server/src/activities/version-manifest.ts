/**
 * What a saved version of an activity holds, worked out from the draft without touching disk.
 *
 * A version is the draft's content, the implementation-features selection, and the files of
 * every medium Penguin owns that the media plan binds: generated narration and images, and
 * uploads. A binding into the WAF checkout is recorded by its path only; the checkout is the
 * author's, read-only, and not Penguin's to copy.
 */
import { canonical, contentRevision, type ActivityDraft } from "./domain.js";
import type { AssetManifest, MediaPlan } from "./media.js";
import { isUploadReference } from "./upload.js";

export interface VersionMedia {
  /** Relative to the draft workspace, e.g. `audio/<runId>.wav` or `media/uploads/<name>`. */
  path: string;
  sha256: string;
  bytes: number;
}

export interface VersionManifest {
  schemaVersion: 1;
  draft: {
    description: string;
    spec: Record<string, unknown> | null;
    mediaPlan?: MediaPlan;
    moduleDocuments?: ActivityDraft["moduleDocuments"];
  };
  /** The selected implementation features, or null when none is selected. */
  implementationFeatures: string[] | null;
  /** Penguin-owned files, by path, sorted. */
  media: VersionMedia[];
  /** Checkout paths the media plan binds, recorded and not copied; sorted. */
  references: string[];
}

/** A file the version must hold, and the digest the media plan says it has, when it says one. */
export interface OwnedMedia {
  path: string;
  expectedSha256: string | null;
}

const RUN_ID = /^run_[a-f0-9]{32}$/;

/**
 * Which bound files belong to Penguin (and where they sit in the draft workspace) and which
 * are checkout references. A generated clip or image lives at `audio/<runId>.wav` (`.mp3` for a sound) or
 * `images/<runId>.png`, a recorded scene video at `videos/<runId>.webm`; an upload lives at its
 * own reference.
 */
export function ownedMediaPaths(manifest: AssetManifest | undefined): {
  owned: OwnedMedia[];
  references: string[];
} {
  const owned = new Map<string, OwnedMedia>();
  const references = new Set<string>();
  for (const asset of Object.values(manifest?.assets ?? {}).flat()) {
    if (asset.generatedAudio && RUN_ID.test(asset.generatedAudio.runId)) {
      const file = `audio/${asset.generatedAudio.runId}.${asset.generatedAudio.format ?? "wav"}`;
      owned.set(file, { path: file, expectedSha256: asset.generatedAudio.sha256 });
    } else if (asset.generatedImage && RUN_ID.test(asset.generatedImage.runId)) {
      const file = `images/${asset.generatedImage.runId}.png`;
      owned.set(file, { path: file, expectedSha256: asset.generatedImage.sha256 });
    } else if (asset.generatedVideo && RUN_ID.test(asset.generatedVideo.runId)) {
      const file = `videos/${asset.generatedVideo.runId}.webm`;
      owned.set(file, { path: file, expectedSha256: asset.generatedVideo.sha256 });
    } else if (isUploadReference(asset.path)) {
      if (!owned.has(asset.path!))
        owned.set(asset.path!, { path: asset.path!, expectedSha256: null });
    } else if (asset.path) references.add(asset.path);
  }
  return {
    owned: [...owned.values()].sort((a, b) => compare(a.path, b.path)),
    references: [...references].sort(compare),
  };
}

/** The version of a draft holding these files; `files` are the owned media, read and hashed. */
export function versionManifest(
  draft: Pick<ActivityDraft, "description" | "spec" | "mediaPlan" | "moduleDocuments">,
  features: readonly string[] | null,
  files: readonly VersionMedia[],
): VersionManifest {
  return {
    schemaVersion: 1,
    draft: {
      description: draft.description,
      spec: draft.spec,
      ...(draft.mediaPlan ? { mediaPlan: draft.mediaPlan } : {}),
      ...(draft.moduleDocuments ? { moduleDocuments: draft.moduleDocuments } : {}),
    },
    implementationFeatures: features ? [...features] : null,
    media: [...files]
      .map(({ path, sha256, bytes }) => ({ path, sha256, bytes }))
      .sort((a, b) => compare(a.path, b.path)),
    references: ownedMediaPaths(draft.mediaPlan?.manifest).references,
  };
}

/** The version's identity: equal content, equal hash. */
export function manifestHash(manifest: VersionManifest): string {
  return contentRevision(manifest);
}

/**
 * The bytes a manifest is stored as: canonical JSON, so the blob's own digest is the
 * manifest's hash.
 */
export function manifestBytes(manifest: VersionManifest): Buffer {
  return Buffer.from(JSON.stringify(canonical(manifest)), "utf8");
}

/** Total size of the media a version holds. */
export function mediaBytes(manifest: VersionManifest): number {
  return manifest.media.reduce((sum, file) => sum + file.bytes, 0);
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
