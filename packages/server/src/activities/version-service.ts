/**
 * Saved versions of an activity: save one, list them, and say which one the draft holds now.
 *
 * Storage is Penguin's own (version-store.ts): a row per version and content-addressed blobs
 * in the activity's directory, holding the version manifest and the bytes of every medium
 * Penguin owns. Checkout media is recorded by path only. A save whose content equals the
 * latest version's makes no new version and returns that one.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import { newId, type ActivityDetail } from "./domain.js";
import {
  IMPLEMENTATION_FEATURES_FILE,
  normalizeFeatureSelection,
} from "./implementation-features.js";
import { withinRoot } from "./sandbox-paths.js";
import {
  manifestBytes,
  manifestHash,
  mediaBytes,
  ownedMediaPaths,
  versionManifest,
  type VersionManifest,
  type VersionMedia,
} from "./version-manifest.js";
import {
  latestVersion,
  listVersions,
  sha256,
  summarizeVersion,
  writeBlob,
  writeVersion,
} from "./version-store.js";
import type {
  VersionKind,
  VersionReason,
  VersionSaveResult,
  VersionSummary,
} from "./version-types.js";

export type {
  VersionKind,
  VersionReason,
  VersionSaveResult,
  VersionSummary,
} from "./version-types.js";

/** The longest name an author may give a version. */
export const VERSION_LABEL_MAX = 80;

export interface VersionSaveInput {
  label?: string | null;
  kind: VersionKind;
  reason?: VersionReason | null;
  /** The user saving it; null when no user did. */
  author: string | null;
  /** The version a restore copied, for a `restore` version. */
  sourceVersionId?: string | null;
}

export abstract class ActivityVersions extends Interface<{
  /**
   * Keep the activity as it is now as a version. When its content equals the latest
   * version's, that version is returned unchanged, `created` is false, and no version is made.
   */
  save(projectId: string, activityId: string, input: VersionSaveInput): Promise<VersionSaveResult>;
  /** Every version of the activity, newest first, marking the one the draft holds now. */
  list(projectId: string, activityId: string): Promise<VersionSummary[]>;
}>() {}

@Component()
export class ActivityVersionService implements ActivityVersions {
  @Use() private readonly authoring!: ActivityAuthoring;
  @Use() private readonly db!: Db;
  /** Digests of files already read, by path, size and modification time. */
  private readonly digests = new Map<string, string>();

  async save(
    projectId: string,
    activityId: string,
    input: VersionSaveInput,
  ): Promise<VersionSaveResult> {
    const label = input.label?.trim() || null;
    if (label && label.length > VERSION_LABEL_MAX)
      throw new HttpError(
        400,
        "invalid_request",
        `label must be at most ${VERSION_LABEL_MAX} characters.`,
      );
    return this.authoring.exclusive(projectId, activityId, async () => {
      const activity = await this.authoring.getActivity(projectId, activityId);
      const { workspace, activityDir } = this.dirs(projectId, activity);
      const files: VersionMedia[] = [];
      // One file at a time: each is read, checked, and stored before the next is opened.
      for (const owned of ownedMediaPaths(activity.draft.mediaPlan?.manifest).owned) {
        const bytes = await this.readOwned(workspace, owned.path);
        const digest = sha256(bytes);
        if (owned.expectedSha256 && owned.expectedSha256 !== digest)
          throw new HttpError(
            409,
            "version_media_changed",
            `The file ${owned.path} changed since it was generated.`,
          );
        await writeBlob(activityDir, bytes);
        files.push({ path: owned.path, sha256: digest, bytes: bytes.length });
      }
      const manifest = versionManifest(activity.draft, await this.readFeatures(workspace), files);
      const hash = manifestHash(manifest);
      const latest = latestVersion(this.db, activityId);
      if (latest && latest.contentHash === hash)
        return { version: summarizeVersion(latest, hash), created: false };
      const manifestSha = await writeBlob(activityDir, manifestBytes(manifest));
      const row = {
        versionId: newId("ver"),
        activityId,
        seq: (latest?.seq ?? 0) + 1,
        label,
        kind: input.kind,
        reason: input.kind === "auto" ? (input.reason ?? null) : null,
        contentHash: hash,
        manifestSha,
        mediaBytes: mediaBytes(manifest),
        moduleRunId: null,
        sourceVersionId: input.sourceVersionId ?? null,
        authorUserId: input.author,
        deployedQaAt: null,
        deployedProdAt: null,
        createdAt: new Date().toISOString(),
      };
      writeVersion(this.db, row);
      return { version: summarizeVersion(row, hash), created: true };
    });
  }

  async list(projectId: string, activityId: string): Promise<VersionSummary[]> {
    const activity = await this.authoring.getActivity(projectId, activityId);
    const rows = listVersions(this.db, activityId);
    if (!rows.length) return [];
    // A file that went missing means no version is the draft as it is now.
    const current = await this.currentManifest(projectId, activity)
      .then(manifestHash)
      .catch(() => null);
    return rows.map((row) => summarizeVersion(row, current));
  }

  /** The draft as a version manifest, hashing the files without storing them. */
  private async currentManifest(
    projectId: string,
    activity: ActivityDetail,
  ): Promise<VersionManifest> {
    const { workspace } = this.dirs(projectId, activity);
    const files: VersionMedia[] = [];
    for (const owned of ownedMediaPaths(activity.draft.mediaPlan?.manifest).owned)
      files.push(await this.digestOwned(workspace, owned.path));
    return versionManifest(activity.draft, await this.readFeatures(workspace), files);
  }

  private dirs(projectId: string, activity: ActivityDetail) {
    const workspace = this.authoring.draftWorkspace(
      projectId,
      activity.collectionId,
      activity.id,
      activity.draft.draftId,
    );
    // The workspace is <collection>/activities/<id>/drafts/<draftId>; versions sit beside drafts.
    return { workspace, activityDir: path.resolve(workspace, "..", "..") };
  }

  private async ownedFile(workspace: string, relative: string) {
    const file = withinRoot(workspace, relative);
    const stat = file ? await fs.lstat(file).catch(() => null) : null;
    if (!file || !stat || stat.isSymbolicLink() || !stat.isFile())
      throw new HttpError(409, "version_media_missing", `The file ${relative} is missing.`);
    return { file, stat };
  }

  private async readOwned(workspace: string, relative: string): Promise<Buffer> {
    const { file } = await this.ownedFile(workspace, relative);
    return fs.readFile(file);
  }

  private async digestOwned(workspace: string, relative: string): Promise<VersionMedia> {
    const { file, stat } = await this.ownedFile(workspace, relative);
    const key = `${file}\0${stat.size}\0${stat.mtimeMs}`;
    let digest = this.digests.get(key);
    if (!digest) {
      digest = sha256(await fs.readFile(file));
      if (this.digests.size > 5000) this.digests.clear();
      this.digests.set(key, digest);
    }
    return { path: relative, sha256: digest, bytes: stat.size };
  }

  /**
   * The selection as stored, or null when nothing is selected. A missing file, an unreadable
   * one and an empty selection all mean the same thing, so they hash the same.
   */
  private async readFeatures(workspace: string): Promise<string[] | null> {
    const text = await fs
      .readFile(path.join(workspace, IMPLEMENTATION_FEATURES_FILE), "utf8")
      .catch(() => null);
    if (text === null) return null;
    try {
      const selected = normalizeFeatureSelection(
        (JSON.parse(text) as { selectedIds?: unknown }).selectedIds,
      );
      return selected.length ? selected : null;
    } catch {
      return null;
    }
  }
}
