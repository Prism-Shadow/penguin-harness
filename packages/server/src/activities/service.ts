import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { buildReadiness } from "./build-readiness.js";
import type { GeneratedAudioFormat, MediaAsset } from "./media.js";
import {
  IMPLEMENTATION_FEATURES,
  IMPLEMENTATION_FEATURES_FILE,
  normalizeFeatureSelection,
  unknownFeatureIds,
} from "./implementation-features.js";
import { DEFAULT_LANGUAGE_CODE, canAddLanguage } from "./languages.js";
import type { ProposalChange } from "./assist.js";
import { validateBookSpec } from "./book.js";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { projectDir } from "@prismshadow/penguin-core";
import type { Config, Db } from "../hmr/capabilities.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import type { ProjectActivityWork } from "../mechanisms/projects.js";
import { HttpError } from "../http/errors.js";
import { generatedAudioPath, planMedia, validateManifest, validateMediaCoverage } from "./media.js";
import { VIDEO_DIR, generatedVideoPath, inspectWebm, readVideoFile } from "./video-render.js";
import type { VideoResult, VideoTarget } from "./video-types.js";
import { mediaTextField, type MediaTextTarget } from "./media-text.js";
import { AUDIO_MAX_BYTES, type AudioResult, type AudioTarget } from "./audio.js";
import { inspectGeneratedAudio } from "./sound.js";
import { soundPromptOf } from "./playback.js";
import { normalizeAlignment, timingManifestFields } from "./word-timings.js";
import { readArtifactBytes } from "./artifact.js";
import {
  isUploadReference,
  listUploads,
  readUpload,
  storeUpload,
  uploadFile,
  type UploadedMedia,
} from "./upload.js";
import { zipSync } from "fflate";
import {
  BUNDLE_MAX_BYTES,
  BUNDLE_MAX_ITEMS,
  MediaLibraryPorts,
  PROJECT_MEDIA_LIMIT,
  bundleEntryNames,
  copiedUploadName,
} from "./media-bundle.js";
import type { BundleItem, LibraryFile, ProjectMediaListing } from "./media-library-types.js";
import { readBoundImage, type ImageRequest } from "./image.js";
import { findWafRoot } from "./waf-module.js";
import {
  GENERATED_IMAGE_MAX_BYTES,
  inspectPng,
  type ImageResult,
  type ImageTarget,
} from "./generated-image.js";
import {
  contentRevision,
  draftRevision,
  newCollectionManifest,
  newId,
  normalizeDisplayName,
  normalizeModuleFolder,
  normalizeProductCode,
  normalizeRefNum,
  type ActivityDetail,
  type ActivityDraft,
  type ActivityProduct,
  type ActivityRecord,
  type CollectionManifest,
  type ModuleDocumentKind,
  type ModuleDocumentOverride,
  validateActivitySpec,
} from "./domain.js";
import {
  assessmentBasis,
  configurationBasis,
  isStale,
  validateAssessment,
  validateConfiguration,
} from "./module-overrides.js";
import { normalizeTags } from "./tags.js";
import type { ActivityPhonemes } from "./phonemes.js";
import {
  cleanPhonemes,
  desiredWords,
  fillPhonemes,
  isBookWord,
  mergeWordAssets,
  wordsMissingPhonemes,
} from "./book-words.js";
import type { BookWordsRefresh, BookWordsState, PhonemesCandidate } from "./book-word-types.js";
import { recordingTimingFields, syncWordScripts } from "./pronunciation.js";
import type { SpeechProviderId } from "./speech-types.js";
import {
  nextFreeRefNum,
  refDraftFromTemplate,
  type RefAssetDecision,
  type RefNumberSuggestion,
} from "./ref-template.js";

/** A run's id, as a pinned module build names one. */
const RUN_ID = /^run_[a-f0-9]{32}$/;

/** Serializes compare-and-publish operations within the server's single-writer lifetime. */
export class ActivityLocks {
  private readonly pending = new Map<string, Promise<unknown>>();
  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(key) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    this.pending.set(key, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(key) === next) this.pending.delete(key);
    }
  }
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  const temp = `${file}.${newId("tmp")}`;
  try {
    await fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", {
      encoding: "utf8",
      flag: "wx",
    });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

@Component()
export class ActivityService implements ActivityAuthoring {
  @Use() private readonly projectWork!: ProjectActivityWork;
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;
  @Use() private readonly mediaLibrary!: MediaLibraryPorts;
  @Use() private readonly phonemes!: ActivityPhonemes;
  private readonly locks = new ActivityLocks();
  /** The activities whose lock the running work already holds, through `exclusive`. */
  private readonly held = new AsyncLocalStorage<ReadonlySet<string>>();

  async imageContent(projectId: string, activityId: string, input: ImageRequest) {
    const activity = await this.getActivity(projectId, activityId);
    const generated = activity.draft.mediaPlan?.manifest.assets[input.language]?.find(
      (asset) => asset.key === input.assetKey,
    )?.generatedImage;
    if (generated) {
      if (activity.draft.contentRevision !== input.expectedRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "The draft changed. Reload it before previewing media.",
        );
      if (
        activity.draft.status !== "valid" ||
        activity.draft.mediaPlan!.specRevision !== contentRevision(activity.draft.spec)
      )
        throw new HttpError(409, "media_stale", "Rebuild the media plan before previewing images.");
      return {
        bytes: await this.readImage(projectId, activityId, generated.runId, generated.sha256),
        mimeType: "image/png",
      };
    }
    const bound = activity.draft.mediaPlan?.manifest.assets[input.language]?.find(
      (asset) => asset.key === input.assetKey,
    )?.path;
    // An upload lives in this activity's workspace; only checkout media needs a WAF root.
    if (isUploadReference(bound))
      return readUpload(this.activityWorkspace(projectId, activity), bound!);
    return readBoundImage(activity, input);
  }

  private activityWorkspace(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
  ): string {
    return this.draftWorkspace(
      projectId,
      activity.collectionId,
      activity.id,
      activity.draft.draftId,
    );
  }
  /**
   * `assessment` is the assessment in effect and the module's own file, when the caller can
   * read the built module; without it, only an author's edit counts.
   */
  async readiness(
    projectId: string,
    activityId: string,
    wafRoot: string,
    assessment?: { current: unknown; own: unknown },
  ) {
    const activity = await this.getActivity(projectId, activityId);
    // The author's checkout when they typed one, or the one assembly would discover.
    const checkout = await findWafRoot(process.cwd(), wafRoot || process.env.WAF_ROOT_DIR);
    return buildReadiness(activity, {
      canonical: this.isCanonicalRef(activity),
      checkoutFound: !!checkout,
      assessment: assessment
        ? (assessment.current ?? null)
        : ((await this.effectiveModuleDocument(projectId, activity, "assessment"))?.value ?? null),
      ownAssessment: assessment?.own ?? null,
      canonicalRefNum: this.productOf(activity)?.canonicalRefNum ?? null,
      bookMode:
        activity.activityType === "book" ? (this.productOf(activity)?.bookMode ?? null) : null,
    });
  }
  async implementationFeatures(projectId: string, activityId: string) {
    const activity = await this.getActivity(projectId, activityId);
    // No file, or one that does not parse, is a ref that has selected nothing.
    const stored: unknown = await fs
      .readFile(
        path.join(this.activityWorkspace(projectId, activity), IMPLEMENTATION_FEATURES_FILE),
        "utf8",
      )
      .then((text) => JSON.parse(text) as unknown)
      .catch(() => null);
    return {
      features: [...IMPLEMENTATION_FEATURES],
      selectedIds: normalizeFeatureSelection(
        (stored as { selectedIds?: unknown } | null)?.selectedIds,
      ),
    };
  }
  async setImplementationFeatures(projectId: string, activityId: string, selectedIds: string[]) {
    const unknown = unknownFeatureIds(selectedIds);
    if (unknown.length)
      throw new HttpError(
        422,
        "features_invalid",
        `Unknown implementation feature: ${unknown.join(", ")}.`,
      );
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const activity = await this.getActivity(projectId, activityId);
        const workspace = this.activityWorkspace(projectId, activity);
        await fs.mkdir(workspace, { recursive: true });
        const selection = normalizeFeatureSelection(selectedIds);
        await atomicJson(path.join(workspace, IMPLEMENTATION_FEATURES_FILE), {
          selectedIds: selection,
        });
        return { features: [...IMPLEMENTATION_FEATURES], selectedIds: selection };
      }),
    );
  }
  async uploadMedia(
    projectId: string,
    activityId: string,
    name: string,
    bytes: Buffer,
  ): Promise<UploadedMedia> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      return storeUpload(this.activityWorkspace(projectId, activity), name, bytes);
    });
  }
  async listMedia(projectId: string, activityId: string): Promise<UploadedMedia[]> {
    const activity = await this.getActivity(projectId, activityId);
    return listUploads(this.activityWorkspace(projectId, activity));
  }
  async uploadContent(
    projectId: string,
    activityId: string,
    reference: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const activity = await this.getActivity(projectId, activityId);
    return readUpload(this.activityWorkspace(projectId, activity), reference);
  }
  /**
   * Every file uploaded to a live activity of this project, newest first. Only metadata is
   * read, as `listUploads` does for one activity. An archived activity is left out, and an
   * activity whose draft index is missing contributes nothing rather than failing the list.
   */
  async projectMedia(projectId: string): Promise<ProjectMediaListing> {
    const files: LibraryFile[] = [];
    for (const activity of await this.listActivities(projectId)) {
      const draftId = this.latestDraftId(activity.id);
      if (!draftId) continue;
      const workspace = this.draftWorkspace(projectId, activity.collectionId, activity.id, draftId);
      for (const upload of await listUploads(workspace))
        files.push({
          ...upload,
          activityId: activity.id,
          activityTitle: activity.displayName || activity.title,
          productCode: activity.productCode,
          refNum: activity.refNum,
        });
    }
    files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return {
      files: files.slice(0, PROJECT_MEDIA_LIMIT),
      truncated: files.length > PROJECT_MEDIA_LIMIT,
    };
  }
  /**
   * Copy a file uploaded to another activity of this project into this one. The copy is an
   * ordinary upload, checked as a browser upload is, so each activity keeps owning its own
   * files and archiving one never breaks the other.
   */
  async copyUpload(
    projectId: string,
    activityId: string,
    fromActivityId: string,
    reference: string,
  ): Promise<UploadedMedia> {
    const { bytes } = await this.uploadContent(projectId, fromActivityId, reference);
    return this.uploadMedia(projectId, activityId, copiedUploadName(reference), bytes);
  }
  /**
   * Several uploads of this project as one zip. Every file's size is checked before any is
   * read, so a bundle over the limit costs a few stats, not the bytes.
   */
  async mediaBundle(projectId: string, items: BundleItem[]): Promise<Uint8Array> {
    if (!items.length || items.length > BUNDLE_MAX_ITEMS)
      throw new HttpError(400, "bad_request", `A bundle holds 1 to ${BUNDLE_MAX_ITEMS} files.`);
    const unique = [
      ...new Map(items.map((item) => [`${item.activityId}\n${item.path}`, item])).values(),
    ];
    const workspaces = new Map<string, string>();
    const files: { file: string; workspace: string; path: string }[] = [];
    let total = 0;
    for (const item of unique) {
      let workspace = workspaces.get(item.activityId);
      if (!workspace) {
        workspace = this.activityWorkspace(
          projectId,
          await this.getActivity(projectId, item.activityId),
        );
        workspaces.set(item.activityId, workspace);
      }
      // A path that is not an upload of this activity is simply not one of its files.
      let file: string | null = null;
      try {
        file = uploadFile(workspace, item.path);
      } catch {
        file = null;
      }
      const stat = file ? await fs.lstat(file).catch(() => null) : null;
      if (!file || !stat || stat.isSymbolicLink() || !stat.isFile())
        throw new HttpError(
          404,
          "media_missing",
          "This uploaded file is no longer in the workspace.",
        );
      total += stat.size;
      if (total > (this.mediaLibrary.bundleMaxBytes ?? BUNDLE_MAX_BYTES))
        throw new HttpError(
          413,
          "bundle_too_large",
          "The chosen files are more than 200 MiB together.",
        );
      files.push({ file, workspace, path: item.path });
    }
    const names = bundleEntryNames(files.map((entry) => path.basename(entry.file)));
    const entries: Record<string, Uint8Array> = {};
    for (const [index, entry] of files.entries()) {
      const { bytes } = await readUpload(entry.workspace, entry.path);
      entries[names[index]!] = bytes;
    }
    // Images, sound and video are compressed already; storing them is as small and faster.
    return zipSync(entries, { level: 0 });
  }
  private latestDraftId(activityId: string): string | undefined {
    return (
      this.db
        .prepare(
          "SELECT draft_id FROM activity_drafts WHERE activity_id = ? ORDER BY updated_at DESC, draft_id LIMIT 1",
        )
        .get(activityId) as { draft_id: string } | undefined
    )?.draft_id;
  }
  /** Stage every uploaded binding beside the generated ones, for assembly. */
  async prepareUploadedMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const source = this.activityWorkspace(projectId, activity);
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!isUploadReference(asset.path) || copied.has(asset.path!)) continue;
      const { bytes } = await readUpload(source, asset.path!);
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }

  private imagePath(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
    runId: string,
  ) {
    if (!/^run_[a-f0-9]{32}$/.test(runId))
      throw new HttpError(404, "run_not_found", "Image candidate not found.");
    return path.join(
      this.draftWorkspace(projectId, activity.collectionId, activity.id, activity.draft.draftId),
      "images",
      `${runId}.png`,
    );
  }
  async storeImage(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<ImageResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const result = inspectPng(bytes, runId);
      const file = this.imagePath(projectId, activity, runId);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      return result;
    });
  }
  async readImage(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array> {
    const activity = await this.getActivity(projectId, activityId);
    const bytes = await readArtifactBytes(
      this.imagePath(projectId, activity, runId),
      GENERATED_IMAGE_MAX_BYTES,
    );
    if (inspectPng(bytes, runId).sha256 !== sha256)
      throw new HttpError(409, "image_changed", "Stored image changed. Generate a new candidate.");
    return bytes;
  }
  async applyImage(
    projectId: string,
    activityId: string,
    target: ImageTarget,
    result: ImageResult,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    await this.readImage(projectId, activityId, result.runId, result.sha256);
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan before accepting an image.",
        );
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== "image" || asset.description !== target.prompt)
        throw new HttpError(
          409,
          "image_changed",
          "The image description changed. Generate a new candidate.",
        );
      asset.path = `media/generated/${result.runId}.png`;
      asset.generatedImage = { runId: result.runId, sha256: result.sha256 };
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async applyMediaText(
    projectId: string,
    activityId: string,
    target: MediaTextTarget,
    text: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    if (!text.trim() || text.length > 5000)
      throw new HttpError(422, "media_text_invalid", "Media text must contain 1–5000 characters.");
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan before accepting improved media text.",
        );
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== target.type || mediaTextField(asset) !== target.text)
        throw new HttpError(
          409,
          "media_text_changed",
          "The selected media text changed. Generate a new candidate.",
        );
      if (target.translation) {
        const source = manifest.assets[DEFAULT_LANGUAGE_CODE]?.find(
          (entry) => entry.key === target.assetKey,
        );
        if (source?.script !== target.translation.from)
          throw new HttpError(
            409,
            "translation_source_changed",
            "The script this translates changed. Translate it again.",
          );
        asset.translatedFrom = target.translation.from;
      }
      if (target.type === "image") asset.description = text;
      else {
        asset.script = text;
        // The timings were for the words this replaces.
        delete asset.wordTimings;
      }
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async prepareImageMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!asset.generatedImage || copied.has(asset.path!)) continue;
      const bytes = await this.readImage(
        projectId,
        activityId,
        asset.generatedImage.runId,
        asset.generatedImage.sha256,
      );
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }

  /** Where a run's recording is kept in the draft workspace: `videos/<runId>.webm`. */
  private videoPath(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
    runId: string,
  ) {
    if (!/^run_[a-f0-9]{32}$/.test(runId))
      throw new HttpError(404, "run_not_found", "Video candidate not found.");
    return path.join(this.activityWorkspace(projectId, activity), VIDEO_DIR, `${runId}.webm`);
  }
  async storeVideo(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<VideoResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      let inspected: { sha256: string; bytes: number };
      try {
        inspected = inspectWebm(bytes);
      } catch (error) {
        throw new HttpError(422, "video_invalid", (error as Error).message);
      }
      const file = this.videoPath(projectId, activity, runId);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      return { runId, ...inspected };
    });
  }
  async discardVideo(projectId: string, activityId: string, runId: string): Promise<void> {
    await this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      await fs.rm(this.videoPath(projectId, activity, runId), { force: true });
    });
  }
  async readVideo(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
  ): Promise<Uint8Array> {
    const activity = await this.getActivity(projectId, activityId);
    const changed = () =>
      new HttpError(409, "video_changed", "The stored video changed. Record it again.");
    let bytes: Buffer;
    try {
      bytes = await readVideoFile(this.videoPath(projectId, activity, runId));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HttpError(404, "run_not_found", "Video candidate not available.");
      throw changed();
    }
    try {
      if (inspectWebm(bytes).sha256 !== sha256) throw changed();
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw changed();
    }
    return bytes;
  }
  async applyVideo(
    projectId: string,
    activityId: string,
    target: VideoTarget,
    result: VideoResult,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    await this.readVideo(projectId, activityId, result.runId, result.sha256);
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan before keeping a recorded video.",
        );
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || (asset.type !== "video" && asset.type !== "animation"))
        throw new HttpError(
          409,
          "video_asset_changed",
          "The video or animation this was recorded for is no longer in the media plan.",
        );
      asset.path = generatedVideoPath(result.runId);
      asset.generatedVideo = { runId: result.runId, sha256: result.sha256 };
      // Measured from the file this replaces.
      delete asset.durationMs;
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async prepareVideoMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!asset.generatedVideo || copied.has(asset.path!)) continue;
      const bytes = await this.readVideo(
        projectId,
        activityId,
        asset.generatedVideo.runId,
        asset.generatedVideo.sha256,
      );
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }
  /**
   * The draft file behind a bound recording's media path (`media/generated/<runId>.webm`), for
   * the player to serve, or null when the path is not a recording this draft binds.
   */
  async boundVideoFile(projectId: string, activityId: string, mediaPath: string) {
    const activity = await this.getActivity(projectId, activityId);
    const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
      .flat()
      .find((asset) => asset.generatedVideo && asset.path === mediaPath)?.generatedVideo;
    return bound ? this.videoPath(projectId, activity, bound.runId) : null;
  }

  private collectionDir(projectId: string, collectionId: string): string {
    return path.join(projectDir(this.config.root, projectId), "activities", collectionId);
  }
  draftWorkspace(
    projectId: string,
    collectionId: string,
    activityId: string,
    draftId: string,
  ): string {
    return path.join(
      this.collectionDir(projectId, collectionId),
      "activities",
      activityId,
      "drafts",
      draftId,
    );
  }

  async ensureCollection(projectId: string, collectionId?: string): Promise<CollectionManifest> {
    return this.projectWork.run(projectId, () =>
      this.ensureCollectionFiles(projectId, collectionId),
    );
  }

  private async ensureCollectionFiles(
    projectId: string,
    collectionId?: string,
  ): Promise<CollectionManifest> {
    return this.locks.run(`collection:${projectId}`, async () => {
      const row = (
        collectionId
          ? this.db
              .prepare(
                "SELECT collection_id FROM activity_collections WHERE project_id = ? AND collection_id = ?",
              )
              .get(projectId, collectionId)
          : this.db
              .prepare(
                "SELECT collection_id FROM activity_collections WHERE project_id = ? ORDER BY created_at, collection_id LIMIT 1",
              )
              .get(projectId)
      ) as { collection_id: string } | undefined;
      if (collectionId && !row)
        throw new HttpError(404, "collection_not_found", "Collection not found.");
      if (row) {
        const manifest = JSON.parse(
          await fs.readFile(
            path.join(this.collectionDir(projectId, row.collection_id), "collection.json"),
            "utf8",
          ),
        ) as CollectionManifest;
        if (manifest.schemaVersion !== 1 || manifest.collectionId !== row.collection_id)
          throw new Error("Collection manifest is corrupt.");
        return manifest;
      }
      const manifest = { ...newCollectionManifest(), collectionId: newId("col") };
      const dir = this.collectionDir(projectId, manifest.collectionId);
      await fs.mkdir(dir, { recursive: true });
      await atomicJson(path.join(dir, "collection.json"), manifest);
      this.db
        .prepare(
          "INSERT INTO activity_collections (project_id, collection_id, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(projectId, manifest.collectionId, dir, manifest.createdAt, manifest.updatedAt);
      return manifest;
    });
  }

  async createActivity(
    projectId: string,
    input: {
      collectionId?: string;
      productCode: unknown;
      refNum: unknown;
      title: string;
      activityType?: "standard" | "book";
      /** Only read when this is the product's first ref; later refs join what exists. */
      moduleFolder?: unknown;
    },
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    let productCode: string, refNum: number;
    try {
      productCode = normalizeProductCode(input.productCode);
      refNum = normalizeRefNum(input.refNum);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    const title = input.title.trim();
    if (!title) throw new HttpError(400, "activity_invalid", "title is required.");
    return this.projectWork.run(projectId, async () => {
      const collection = await this.ensureCollectionFiles(projectId, input.collectionId);
      return this.locks.run(`create:${collection.collectionId}`, async () => {
        const taken = this.db
          .prepare(
            "SELECT archived FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ?",
          )
          .get(collection.collectionId, productCode, refNum) as { archived: number } | undefined;
        // A deleted ref keeps its row, and with it the number: its files are still on disk
        // under that address, and a new ref reusing it would read as the old one.
        if (taken?.archived)
          throw new HttpError(
            409,
            "activity_archived",
            `An archived activity already uses ref ${refNum} of this product.`,
          );
        if (taken)
          throw new HttpError(
            409,
            "activity_exists",
            "This productCode/refNum is already reserved.",
          );
        const now = new Date().toISOString();
        const activityType = input.activityType ?? "standard";
        // A ref belongs to a product, and the first ref of a product creates it and is its
        // canonical one: the module code has to belong to some ref, and the only ref there
        // is at that moment is this one.
        const product = this.ensureProduct({
          projectId,
          collectionId: collection.collectionId,
          productCode,
          activityType,
          moduleFolder: input.moduleFolder,
          now,
        });
        const activity: ActivityRecord = {
          id: newId("act"),
          collectionId: collection.collectionId,
          productId: product.productId,
          productCode,
          refNum,
          title,
          displayName: null,
          stable: false,
          activityType,
          createdAt: now,
          updatedAt: now,
          archived: false,
          tags: this.productTags(product.productId),
        };
        const draft: ActivityDraft = {
          draftId: newId("draft"),
          activityId: activity.id,
          baseVersionId: null,
          contentRevision: contentRevision({ description: "", spec: null }),
          status: "draft",
          description: "",
          spec: null,
          updatedAt: now,
        };
        await this.writeDraft(projectId, draft, collection.collectionId);
        this.db.exec("BEGIN");
        try {
          this.db
            .prepare(
              "INSERT INTO activities (id, collection_id, product_id, product_code, ref_num, title, display_name, stable, activity_type, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, NULL, 0, ?, ?, ?, 0)",
            )
            .run(
              activity.id,
              activity.collectionId,
              activity.productId,
              productCode,
              refNum,
              title,
              activity.activityType,
              now,
              now,
            );
          // The product's canonical ref is whichever ref existed first; a product created
          // by this very activity has none yet.
          this.db
            .prepare(
              "UPDATE activity_products SET canonical_ref_num = ?, updated_at = ? WHERE product_id = ? AND canonical_ref_num IS NULL",
            )
            .run(refNum, now, activity.productId);
          this.db
            .prepare(
              "INSERT INTO activity_drafts (draft_id, activity_id, base_version_id, content_revision, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
            )
            .run(draft.draftId, activity.id, draft.contentRevision, draft.status, now);
          this.db.exec("COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
        return { ...activity, draft };
      });
    });
  }

  async listActivities(projectId: string, collectionId?: string): Promise<ActivityRecord[]> {
    // Every tag of the project's products in one query, rather than one per listed ref.
    const tags = new Map<string, string[]>();
    for (const row of this.db
      .prepare(
        `SELECT t.product_id AS productId, t.tag AS tag FROM activity_product_tags t
      JOIN activity_products p ON p.product_id = t.product_id
      WHERE p.project_id = ? ORDER BY t.product_id, t.position`,
      )
      .all(projectId) as { productId: string; tag: string }[])
      tags.set(row.productId, [...(tags.get(row.productId) ?? []), row.tag]);
    return (
      this.db
        .prepare(
          `SELECT a.* FROM activities a
      JOIN activity_collections c ON c.collection_id = a.collection_id
      WHERE c.project_id = ? AND a.archived = 0 AND (? IS NULL OR a.collection_id = ?)
      ORDER BY a.product_code, a.ref_num, a.id`,
        )
        .all(projectId, collectionId ?? null, collectionId ?? null) as Record<string, unknown>[]
    ).map((row) => this.mapActivity(row, tags.get((row.product_id as string | null) ?? "") ?? []));
  }

  async getActivity(
    projectId: string,
    activityId: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    const row = this.db
      .prepare(
        `SELECT a.* FROM activities a
      JOIN activity_collections c ON c.collection_id = a.collection_id
      WHERE a.id = ? AND c.project_id = ? AND a.archived = 0`,
      )
      .get(activityId, projectId) as Record<string, unknown> | undefined;
    if (!row) throw new HttpError(404, "activity_not_found", "Activity not found.");
    const activity = this.mapActivity(row, this.productTags(row.product_id as string | null));
    const draftRow = this.db
      .prepare(
        "SELECT draft_id FROM activity_drafts WHERE activity_id = ? ORDER BY updated_at DESC, draft_id LIMIT 1",
      )
      .get(activityId) as { draft_id: string } | undefined;
    if (!draftRow) throw new Error("Activity draft index is missing.");
    const stored = JSON.parse(
      await fs.readFile(
        path.join(
          this.draftWorkspace(projectId, activity.collectionId, activityId, draftRow.draft_id),
          "draft.json",
        ),
        "utf8",
      ),
    ) as ActivityDraft;
    let file = stored;
    if (
      file.draftId !== draftRow.draft_id ||
      file.activityId !== activityId ||
      typeof file.description !== "string" ||
      (file.spec !== null && (typeof file.spec !== "object" || Array.isArray(file.spec)))
    )
      throw new Error("Activity draft is corrupt.");
    if (file.moduleDocuments !== undefined && !validModuleDocuments(file.moduleDocuments))
      throw new Error("Activity draft is corrupt.");
    if (
      file.pinnedModuleRunId !== undefined &&
      (typeof file.pinnedModuleRunId !== "string" || !RUN_ID.test(file.pinnedModuleRunId))
    )
      throw new Error("Activity draft is corrupt.");
    if (file.mediaPlan) {
      if (!/^[a-f0-9]{64}$/.test(file.mediaPlan.specRevision))
        throw new Error("Media plan is corrupt.");
      const requirements = file.mediaPlan.requirements;
      if (
        !requirements ||
        typeof requirements !== "object" ||
        Array.isArray(requirements) ||
        Object.values(requirements).some(
          (value) => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value),
        )
      )
        throw new Error("Media requirements are corrupt.");
      const manifest = file.mediaPlan.manifest as unknown;
      // The row owns the ref's address. A renumber indexes the new number before it
      // rewrites draft.json, so a read in between (or after a crash there) finds the old
      // number in the manifest; it is read under the row's number, and the next save
      // writes it that way.
      if (
        manifest &&
        typeof manifest === "object" &&
        !Array.isArray(manifest) &&
        (manifest as { productCode?: unknown }).productCode === activity.productCode &&
        (manifest as { refNum?: unknown }).refNum !== activity.refNum &&
        Number.isSafeInteger((manifest as { refNum?: unknown }).refNum)
      )
        file = {
          ...file,
          mediaPlan: {
            ...file.mediaPlan,
            manifest: { ...file.mediaPlan.manifest, refNum: activity.refNum },
          },
        };
      validateManifest(file.mediaPlan!.manifest, activity);
    }
    // The file is authoritative. Never substitute the index for missing/corrupt content.
    const revision = draftRevision(file);
    return {
      ...activity,
      draft: {
        ...file,
        contentRevision: revision,
        status: draftRevision(stored) === stored.contentRevision ? stored.status : "draft",
      },
    };
  }

  /**
   * An agent's whole proposal, applied as one change to the draft so that it lands whole or
   * not at all. Media text goes first, while the plan still matches the specification it
   * was planned from; then the script; then the specification, whose new revision leaves
   * the plan to be rebuilt, as any specification change does.
   */
  async applyProposal(
    projectId: string,
    activityId: string,
    changes: ProposalChange[],
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      let next: ActivityDraft = { ...draft };
      const media = changes.filter(
        (change): change is Extract<ProposalChange, { target: "media" }> =>
          change.target === "media",
      );
      if (media.length) {
        const plan = next.mediaPlan;
        if (!plan || next.status !== "valid" || plan.specRevision !== contentRevision(next.spec))
          throw new HttpError(
            409,
            "media_stale",
            "Rebuild the media plan from the saved specification before applying media changes.",
          );
        const manifest = structuredClone(plan.manifest);
        for (const change of media) {
          const asset = manifest.assets[change.language]?.find(
            (item) => item.key === change.assetKey,
          );
          if (!asset || (change.field === "script" && asset.type !== "audio"))
            throw new HttpError(
              422,
              "proposal_invalid",
              `The media plan has no ${change.language} ${change.field === "script" ? "narration" : "asset"} named ${change.assetKey}.`,
            );
          asset[change.field] = change.text;
          if (change.field === "script") delete asset.wordTimings;
        }
        try {
          next = {
            ...next,
            mediaPlan: { ...plan, manifest: validateManifest(manifest, activity) },
          };
        } catch (error) {
          throw new HttpError(422, "media_invalid", (error as Error).message);
        }
      }
      const description = changes.find((change) => change.target === "description");
      if (description) next = { ...next, description: description.text, status: "draft" };
      const spec = changes.find((change) => change.target === "spec");
      if (spec) {
        let parsed: Record<string, unknown>;
        try {
          parsed = validateActivitySpec(spec.spec);
          if (activity.activityType === "book") validateBookSpec(parsed);
        } catch (error) {
          throw new HttpError(422, "spec_invalid", (error as Error).message);
        }
        next = { ...next, spec: parsed, status: "valid" };
      }
      return next;
    });
  }
  /**
   * Save an author's edit of a module document. It replaces the generated document in the
   * preview and in every assembly until it is discarded. The assessment is shared by every
   * ref of the product, so only the canonical ref may edit it. `baseline` is the document the
   * author was editing; an assessment problem it already had does not refuse the save.
   */
  async setModuleDocument(
    projectId: string,
    activityId: string,
    kind: ModuleDocumentKind,
    value: unknown,
    expectedRevision: string,
    baseline?: unknown,
  ): Promise<ActivityDraft> {
    const document =
      kind === "assessment" ? validateAssessment(value, baseline) : validateConfiguration(value);
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      if (kind === "assessment" && !this.isCanonicalRef(activity))
        throw new HttpError(
          409,
          "not_canonical",
          "The assessment is shared by every ref of this product. Edit it on the canonical ref.",
        );
      const override: ModuleDocumentOverride = {
        value: document,
        basis: kind === "assessment" ? assessmentBasis(draft) : configurationBasis(draft),
        editedAt: new Date().toISOString(),
      };
      return { ...draft, moduleDocuments: { ...draft.moduleDocuments, [kind]: override } };
    });
  }

  /** Remove an author's edit, so the module's own document is used again. */
  async discardModuleDocument(
    projectId: string,
    activityId: string,
    kind: ModuleDocumentKind,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const { moduleDocuments, ...rest } = draft;
      const { [kind]: _removed, ...kept } = moduleDocuments ?? {};
      // With nothing left the key goes too, so the draft's revision is what it was before.
      return Object.keys(kept).length ? { ...rest, moduleDocuments: kept } : rest;
    });
  }

  /**
   * The edit that applies to this ref, and whether it is stale: its own configuration, or
   * the product's assessment, which lives in the canonical ref's draft.
   */
  async effectiveModuleDocument(
    projectId: string,
    activity: ActivityDetail,
    kind: ModuleDocumentKind,
  ): Promise<(ModuleDocumentOverride & { stale: boolean }) | null> {
    let draft = activity.draft;
    if (kind === "assessment" && !this.isCanonicalRef(activity)) {
      const canonicalRefNum = this.productOf(activity)?.canonicalRefNum ?? null;
      const row = this.db
        .prepare(
          "SELECT id FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ? AND archived = 0",
        )
        .get(activity.collectionId, activity.productCode, canonicalRefNum) as
        { id: string } | undefined;
      if (!row) return null;
      draft = (await this.getActivity(projectId, row.id)).draft;
    }
    const override = draft.moduleDocuments?.[kind];
    if (!override) return null;
    const basis = kind === "assessment" ? assessmentBasis(draft) : configurationBasis(draft);
    return { ...override, stale: isStale(override, basis) };
  }
  async updateDescription(
    projectId: string,
    activityId: string,
    description: string,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft) => ({
      ...draft,
      description,
      status: "draft",
    }));
  }
  async applySpec(
    projectId: string,
    activityId: string,
    spec: unknown,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    let parsed: Record<string, unknown>;
    try {
      parsed = validateActivitySpec(spec);
    } catch (error) {
      throw new HttpError(422, "spec_invalid", (error as Error).message);
    }
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      if (activity.activityType === "book") {
        try {
          validateBookSpec(parsed);
        } catch (error) {
          throw new HttpError(422, "spec_invalid", (error as Error).message);
        }
      }
      return { ...draft, spec: parsed, status: "valid" };
    });
  }
  async planMedia(
    projectId: string,
    activityId: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      try {
        return { ...draft, mediaPlan: planMedia({ ...activity, draft }) };
      } catch (error) {
        throw new HttpError(422, "media_invalid", (error as Error).message);
      }
    });
  }
  /**
   * A language added to the media plan, from the product's language table. A
   * language's group holds only what it says differently: the scripted narration, without
   * its script, so each reads as needing translation rather than passing an English line
   * off as a translated one. Pictures, music and effects fall back to the default.
   */
  async addLanguage(
    projectId: string,
    activityId: string,
    language: string,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      const plan = draft.mediaPlan;
      if (!plan || draft.status !== "valid" || plan.specRevision !== contentRevision(draft.spec))
        throw new HttpError(409, "media_stale", "Plan media from the saved specification first.");
      const refusal = canAddLanguage(Object.keys(plan.manifest.assets), language);
      if (refusal) throw new HttpError(422, "language_invalid", refusal.message);
      const group = plan.manifest.assets[DEFAULT_LANGUAGE_CODE]!.filter(
        (asset) =>
          asset.type === "audio" && !asset.kind && !isBookWord(asset) && !!asset.script?.trim(),
      ).map((asset) => {
        const {
          script: _script,
          path: _path,
          generatedAudio: _audio,
          translatedFrom: _from,
          ...rest
        } = structuredClone(asset);
        return rest;
      });
      const manifest = validateManifest(
        { ...plan.manifest, assets: { ...plan.manifest.assets, [language]: group } },
        activity,
      );
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async bookWordsState(projectId: string, activityId: string): Promise<BookWordsState> {
    const activity = await this.getActivity(projectId, activityId);
    const product = activity.activityType === "book" ? this.productOf(activity) : null;
    return { bookMode: product?.bookMode ?? null, espeak: await this.phonemes.status() };
  }
  /**
   * A decodable book's words, brought in line with its story: Loom's book words, as assets of
   * the language group (book-words.ts), with sounds from espeak-ng for each word that has
   * none and that the author has not made their own. Refused for anything that is not a
   * decodable book: the product's recorded reading mode decides, and only where it records
   * none does the author's `bookMode` count. A choice the author makes that way is recorded
   * on the product once the refresh succeeds, so it holds for every later refresh and reload.
   */
  async refreshBookWords(
    projectId: string,
    activityId: string,
    language: string,
    expectedRevision: string,
    bookMode?: "decodable" | "readAlong",
  ): Promise<BookWordsRefresh> {
    const activity = await this.getActivity(projectId, activityId);
    const product = activity.activityType === "book" ? this.productOf(activity) : null;
    const recorded = product?.bookMode ?? null;
    if (activity.activityType !== "book" || (recorded ?? bookMode) !== "decodable")
      throw new HttpError(
        409,
        "not_decodable",
        "Word pronunciations are planned for decodable books only.",
      );
    const planned = this.plannedWords(activity, language);
    // espeak-ng runs outside the draft lock; its answer is used only if the words it was asked
    // about are still the ones the draft holds when the change is made.
    const missing = wordsMissingPhonemes(mergeWordAssets(planned.group, planned.desired));
    const found = await this.phonemes.phonemesFor(missing, language);
    let still: string[] = [];
    const draft = await this.change(projectId, activityId, expectedRevision, (current, record) => {
      const { plan, group, desired } = this.plannedWords({ ...record, draft: current }, language);
      const merged = mergeWordAssets(group, desired);
      fillPhonemes(merged, new Map(Object.entries(found)), "espeak");
      syncWordScripts(merged, group);
      still = wordsMissingPhonemes(merged);
      const manifest = this.validWordManifest(
        { ...plan.manifest, assets: { ...plan.manifest.assets, [language]: merged } },
        record,
      );
      return { ...current, mediaPlan: { ...plan, manifest } };
    });
    if (product && !recorded)
      await this.setProductBookMode(
        projectId,
        product.collectionId,
        product.productCode,
        "decodable",
      );
    return { draft, missing: still };
  }
  /** The media plan and a language group of a book, and the words its story shows. */
  private plannedWords(activity: ActivityRecord & { draft: ActivityDraft }, language: string) {
    const { draft } = activity;
    const plan = draft.mediaPlan;
    if (!plan || draft.status !== "valid" || plan.specRevision !== contentRevision(draft.spec))
      throw new HttpError(409, "media_stale", "Plan media from the saved specification first.");
    const group = plan.manifest.assets[language];
    if (!group)
      throw new HttpError(422, "language_invalid", "The media plan has no such language group.");
    try {
      return {
        plan,
        group,
        desired: desiredWords(draft.spec!, group, language, DEFAULT_LANGUAGE_CODE),
      };
    } catch (error) {
      throw new HttpError(422, "spec_invalid", (error as Error).message);
    }
  }
  private validWordManifest(manifest: unknown, activity: ActivityRecord) {
    try {
      return validateManifest(manifest, activity);
    } catch (error) {
      throw new HttpError(422, "media_invalid", (error as Error).message);
    }
  }
  /** One word asset of a language group, found for an edit, or a 404. */
  private bookWord(draft: ActivityDraft, language: string, assetKey: string) {
    const plan = draft.mediaPlan;
    const manifest = plan ? structuredClone(plan.manifest) : null;
    const asset = manifest?.assets[language]?.find((entry) => entry.key === assetKey);
    if (!plan || !manifest || !asset || !isBookWord(asset))
      throw new HttpError(404, "book_word_not_found", "No such word pronunciation.");
    return { plan, manifest, asset };
  }
  async setWordPhonemes(
    projectId: string,
    activityId: string,
    language: string,
    assetKey: string,
    phonemes: unknown,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    const sounds = cleanPhonemes(phonemes);
    if (!sounds)
      throw new HttpError(
        400,
        "phonemes_invalid",
        "Give between 1 and 32 sounds, each 1 to 8 characters.",
      );
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      const { plan, manifest, asset } = this.bookWord(draft, language, assetKey);
      asset.phonemes = sounds;
      asset.phonemeSource = "author";
      asset.customized = true;
      syncWordScripts(manifest.assets[language]!, plan.manifest.assets[language]);
      return {
        ...draft,
        mediaPlan: { ...plan, manifest: this.validWordManifest(manifest, activity) },
      };
    });
  }
  async applyPhonemes(
    projectId: string,
    activityId: string,
    candidate: PhonemesCandidate,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      const plan = draft.mediaPlan;
      const group = plan?.manifest.assets[candidate.language];
      if (!plan || !group)
        throw new HttpError(409, "media_stale", "Plan media from the saved specification first.");
      const manifest = structuredClone(plan.manifest);
      fillPhonemes(
        manifest.assets[candidate.language]!,
        new Map(Object.entries(candidate.phonemes)),
        "model",
      );
      syncWordScripts(manifest.assets[candidate.language]!, group);
      return {
        ...draft,
        mediaPlan: { ...plan, manifest: this.validWordManifest(manifest, activity) },
      };
    });
  }
  /**
   * Ready a language's words for recording (every language without `language`): a word with
   * sounds and no recording that names no speech provider is given `provider`, and every
   * word's script is brought in line with its sounds and provider, unless the author wrote it.
   */
  async prepareWordRecordings(
    projectId: string,
    activityId: string,
    provider: SpeechProviderId,
    expectedRevision: string,
    language?: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      const plan = draft.mediaPlan;
      if (!plan || draft.status !== "valid" || plan.specRevision !== contentRevision(draft.spec))
        throw new HttpError(409, "media_stale", "Plan media from the saved specification first.");
      const manifest = structuredClone(plan.manifest);
      for (const [code, group] of Object.entries(manifest.assets)) {
        if (language !== undefined && code !== language) continue;
        for (const asset of group)
          if (isBookWord(asset) && asset.phonemes?.length && !asset.path && !asset.speechProvider)
            asset.speechProvider = provider;
        syncWordScripts(group, plan.manifest.assets[code]);
      }
      return {
        ...draft,
        mediaPlan: { ...plan, manifest: this.validWordManifest(manifest, activity) },
      };
    });
  }
  async applyMedia(
    projectId: string,
    activityId: string,
    manifest: unknown,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, async (draft, activity) => {
      if (
        !draft.mediaPlan ||
        draft.mediaPlan.specRevision !== contentRevision(draft.spec) ||
        draft.status !== "valid"
      )
        throw new HttpError(
          409,
          "media_stale",
          "Rebuild the media plan from the saved specification before saving bindings.",
        );
      try {
        const parsed = validateManifest(manifest, activity);
        // A word's script follows its sounds and provider unless the author wrote it.
        for (const [language, assets] of Object.entries(parsed.assets))
          syncWordScripts(assets, draft.mediaPlan.manifest.assets[language]);
        validateMediaCoverage(parsed, { ...activity, draft });
        for (const [language, assets] of Object.entries(parsed.assets)) {
          for (const asset of assets) {
            if (!asset.generatedImage) continue;
            const accepted = draft.mediaPlan.manifest.assets[language]?.find(
              (previous) => previous.key === asset.key,
            )?.generatedImage;
            if (
              !accepted ||
              accepted.runId !== asset.generatedImage.runId ||
              accepted.sha256 !== asset.generatedImage.sha256
            )
              throw new Error("Use Accept this image to bind a generated candidate.");
          }
          for (const asset of assets) {
            if (!asset.generatedVideo) continue;
            const accepted = draft.mediaPlan.manifest.assets[language]?.find(
              (previous) => previous.key === asset.key,
            )?.generatedVideo;
            if (
              !accepted ||
              accepted.runId !== asset.generatedVideo.runId ||
              accepted.sha256 !== asset.generatedVideo.sha256
            )
              throw new Error("Keep a recorded video from its comparison to bind it.");
          }
        }
        // An upload is bytes this server holds, so what it actually is can be checked
        // rather than assumed. A path alone says nothing about the media it names.
        const workspace = this.activityWorkspace(projectId, { ...activity, draft });
        for (const assets of Object.values(parsed.assets))
          for (const asset of assets) {
            if (!isUploadReference(asset.path)) continue;
            const { mimeType } = await readUpload(workspace, asset.path!);
            const kind = mimeType.slice(0, mimeType.indexOf("/"));
            const wanted =
              asset.type === "image" ? "image" : asset.type === "audio" ? "audio" : "video";
            if (kind !== wanted)
              throw new Error(
                `Asset ${asset.key} expects ${wanted} media, but ${asset.path} holds ${kind} media.`,
              );
          }
        return { ...draft, mediaPlan: { ...draft.mediaPlan, manifest: parsed } };
      } catch (error) {
        throw new HttpError(422, "media_invalid", (error as Error).message);
      }
    });
  }
  async storeAudio(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
    format?: GeneratedAudioFormat,
  ): Promise<AudioResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const result = inspectGeneratedAudio(bytes, runId, format);
      const file = this.audioPath(projectId, activity, runId, format);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      return result;
    });
  }
  private audioPath(
    projectId: string,
    activity: ActivityRecord & { draft: ActivityDraft },
    runId: string,
    format: GeneratedAudioFormat | undefined,
  ): string {
    if (!/^run_[a-f0-9]{32}$/.test(runId))
      throw new HttpError(404, "run_not_found", "Audio candidate not found.");
    return path.join(
      this.draftWorkspace(projectId, activity.collectionId, activity.id, activity.draft.draftId),
      "audio",
      `${runId}.${format ?? "wav"}`,
    );
  }
  async readAudio(
    projectId: string,
    activityId: string,
    runId: string,
    sha256: string,
    format?: GeneratedAudioFormat,
  ): Promise<Uint8Array> {
    const activity = await this.getActivity(projectId, activityId);
    const bytes = await readArtifactBytes(
      this.audioPath(projectId, activity, runId, format),
      AUDIO_MAX_BYTES,
    );
    if (inspectGeneratedAudio(bytes, runId, format).sha256 !== sha256)
      throw new HttpError(409, "audio_changed", "Stored audio changed. Generate a new candidate.");
    return bytes;
  }
  async applyAudio(
    projectId: string,
    activityId: string,
    target: AudioTarget,
    result: AudioResult,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    // Verify immutable bytes before the same compare-and-publish lock used by all draft edits.
    await this.readAudio(projectId, activityId, result.runId, result.sha256, result.format);
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const plan = draft.mediaPlan;
      if (!plan || plan.specRevision !== contentRevision(draft.spec) || draft.status !== "valid")
        throw new HttpError(409, "media_stale", "Rebuild the media plan before accepting speech.");
      const manifest = structuredClone(plan.manifest);
      const asset = manifest.assets[target.language]?.find(
        (entry) => entry.key === target.assetKey,
      );
      if (!asset || asset.type !== "audio" || asset.script !== target.script)
        throw new HttpError(
          409,
          "audio_changed",
          target.sound
            ? "The sound's prompt changed. Generate a new candidate."
            : "The speech requirement changed. Generate a new candidate.",
        );
      // A sound was made for music or an effect; an asset that has become narration is not it.
      if (target.sound && (!asset.kind || soundPromptOf(asset.script) !== target.sound.prompt))
        throw new HttpError(
          409,
          "audio_changed",
          "The sound's prompt changed. Generate a new candidate.",
        );
      const generated = {
        runId: result.runId,
        sha256: result.sha256,
        ...(result.format === "mp3" ? { format: "mp3" as const } : {}),
      };
      asset.path = generatedAudioPath(generated);
      asset.generatedAudio = generated;
      // The timings and length described the recording this replaces; playback stays.
      delete asset.wordTimings;
      delete asset.durationMs;
      // A provider that timed the words (ElevenLabs) leaves its timings and the clip's length;
      // one that did not (Gemini) records nothing rather than an empty alignment.
      const timings = result.wordTimings?.length
        ? normalizeAlignment(asset.script ?? "", result.wordTimings)
        : null;
      if (timings) Object.assign(asset, timingManifestFields(timings, result.durationMs));
      // A word pronunciation's two timings are its drawn-out sounds and the word itself.
      delete asset.phonemeTimings;
      delete asset.wholeWordTiming;
      if (isBookWord(asset)) Object.assign(asset, recordingTimingFields(asset));
      return { ...draft, mediaPlan: { ...plan, manifest } };
    });
  }
  async prepareAudioMedia(
    projectId: string,
    activityId: string,
    workspace: string,
    expectedRevision: string,
  ): Promise<void> {
    const activity = await this.getActivity(projectId, activityId);
    if (activity.draft.contentRevision !== expectedRevision)
      throw new HttpError(409, "draft_conflict", "Media changed before assembly.");
    const copied = new Set<string>();
    for (const asset of Object.values(activity.draft.mediaPlan?.manifest.assets ?? {}).flat()) {
      if (!asset.generatedAudio || copied.has(asset.path!)) continue;
      const bytes = await this.readAudio(
        projectId,
        activityId,
        asset.generatedAudio.runId,
        asset.generatedAudio.sha256,
        asset.generatedAudio.format,
      );
      const file = path.join(workspace, asset.path!);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes, { flag: "wx" });
      copied.add(asset.path!);
    }
  }
  async exclusive<T>(
    projectId: string,
    activityId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    // Inside an exclusive run of this activity, a draft change joins it instead of waiting
    // behind it for ever.
    if (this.held.getStore()?.has(activityId)) return operation();
    const held = new Set([...(this.held.getStore() ?? []), activityId]);
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, () => this.held.run(held, operation)),
    );
  }
  /**
   * The draft made to hold `content`, as a restore of a saved version writes it: status and
   * revision are worked out as a saved specification's are, except that a specification
   * the script was edited after (`staleSpec`) stays "draft", and a part `content` lacks is
   * removed from the draft.
   */
  async replaceDraft(
    projectId: string,
    activityId: string,
    content: Pick<ActivityDraft, "description" | "spec" | "mediaPlan" | "moduleDocuments">,
    expectedRevision: string,
    staleSpec = false,
  ): Promise<ActivityDraft> {
    return this.change(projectId, activityId, expectedRevision, (draft, activity) => {
      const { mediaPlan: _plan, moduleDocuments: _documents, ...rest } = draft;
      const next: ActivityDraft = {
        ...rest,
        description: content.description,
        spec: content.spec ? structuredClone(content.spec) : null,
        status: "draft",
      };
      if (next.spec && !staleSpec) {
        try {
          validateActivitySpec(next.spec);
          if (activity.activityType === "book") validateBookSpec(next.spec);
          next.status = "valid";
        } catch {
          // Kept as it was saved, so the author can see and fix what no longer passes.
          next.status = "invalid";
        }
      }
      if (content.mediaPlan) {
        const plan = structuredClone(content.mediaPlan);
        plan.manifest.refNum = activity.refNum;
        try {
          validateManifest(plan.manifest, activity);
        } catch (error) {
          throw new HttpError(422, "media_invalid", (error as Error).message);
        }
        next.mediaPlan = plan;
      }
      if (content.moduleDocuments) next.moduleDocuments = structuredClone(content.moduleDocuments);
      return next;
    });
  }
  /**
   * Pin the module build the preview plays (`runId`), or unpin it (null) so the newest plays
   * again. The caller checks the run is a succeeded module run of this activity. The pin is
   * not part of the draft's revision, so `expectedRevision` only checks the author saw the
   * current draft, and the revision stays what it was.
   */
  async pinModuleRun(
    projectId: string,
    activityId: string,
    runId: string | null,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    if (runId !== null && !RUN_ID.test(runId))
      throw new HttpError(400, "invalid_request", "runId is not a run id.");
    return this.change(projectId, activityId, expectedRevision, (draft) => {
      const { pinnedModuleRunId: _pinned, ...rest } = draft;
      return runId === null ? rest : { ...rest, pinnedModuleRunId: runId };
    });
  }
  private async change(
    projectId: string,
    activityId: string,
    expectedRevision: string | undefined,
    edit: (
      draft: ActivityDraft,
      activity: ActivityRecord,
    ) => ActivityDraft | Promise<ActivityDraft>,
  ): Promise<ActivityDraft> {
    return this.exclusive(projectId, activityId, async () => {
      const current = await this.getActivity(projectId, activityId);
      if (!expectedRevision || expectedRevision !== current.draft.contentRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "Draft changed. Reload it before applying your edit.",
        );
      const draft = await edit(current.draft, current);
      draft.contentRevision = draftRevision(draft);
      draft.updatedAt = new Date().toISOString();
      await this.writeDraft(projectId, draft, current.collectionId);
      this.db
        .prepare(
          "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
        )
        .run(draft.contentRevision, draft.status, draft.updatedAt, draft.draftId);
      this.db
        .prepare("UPDATE activities SET title = ?, updated_at = ? WHERE id = ?")
        .run(
          draft.status === "valid" ? (draft.spec!.title as string) : current.title,
          draft.updatedAt,
          activityId,
        );
      return draft;
    });
  }
  private async writeDraft(
    projectId: string,
    draft: ActivityDraft,
    collectionId: string,
  ): Promise<void> {
    const dir = this.draftWorkspace(projectId, collectionId, draft.activityId, draft.draftId);
    await fs.mkdir(dir, { recursive: true });
    // These two files are exports; only the atomically published draft is authoritative.
    if (draft.spec !== null) await atomicJson(path.join(dir, "activity-spec.json"), draft.spec);
    if (draft.mediaPlan)
      await atomicJson(path.join(dir, "asset-manifest.json"), draft.mediaPlan.manifest);
    await fs.writeFile(path.join(dir, "description.md"), draft.description, "utf8");
    await atomicJson(path.join(dir, "draft.json"), draft);
  }
  private mapActivity(row: Record<string, unknown>, tags: string[]): ActivityRecord {
    return {
      id: row.id as string,
      collectionId: row.collection_id as string,
      productId: (row.product_id as string | null) ?? null,
      productCode: row.product_code as string,
      refNum: row.ref_num as number,
      title: row.title as string,
      displayName: (row.display_name as string | null) ?? null,
      stable: Boolean(row.stable),
      activityType: row.activity_type as ActivityRecord["activityType"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      archived: Boolean(row.archived),
      tags,
    };
  }

  /** A product's tags in the order the author gave them; none for a ref with no product. */
  private productTags(productId: string | null): string[] {
    if (!productId) return [];
    return (
      this.db
        .prepare("SELECT tag FROM activity_product_tags WHERE product_id = ? ORDER BY position")
        .all(productId) as { tag: string }[]
    ).map((row) => row.tag);
  }

  private mapProduct(row: Record<string, unknown>): ActivityProduct {
    return {
      productId: row.product_id as string,
      projectId: row.project_id as string,
      collectionId: row.collection_id as string,
      productCode: row.product_code as string,
      moduleFolder: row.module_folder as string,
      canonicalRefNum: (row.canonical_ref_num as number | null) ?? null,
      activityType: row.activity_type as ActivityProduct["activityType"],
      bookMode: (row.book_mode as ActivityProduct["bookMode"]) ?? null,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }

  /**
   * The product a ref belongs to, created on first use.
   *
   * A product is not something an author makes on purpose: it appears the moment the
   * first ref of a product code does, and every later ref of that code joins it. Its type
   * comes from the ref that created it, because that ref is also its canonical one.
   */
  private ensureProduct(input: {
    projectId: string;
    collectionId: string;
    productCode: string;
    activityType: ActivityRecord["activityType"];
    moduleFolder?: unknown;
    now: string;
  }): ActivityProduct {
    const existing = this.db
      .prepare("SELECT * FROM activity_products WHERE collection_id = ? AND product_code = ?")
      .get(input.collectionId, input.productCode) as Record<string, unknown> | undefined;
    if (existing) return this.mapProduct(existing);
    const product: ActivityProduct = {
      productId: newId("prd"),
      projectId: input.projectId,
      collectionId: input.collectionId,
      productCode: input.productCode,
      moduleFolder: normalizeModuleFolder(input.moduleFolder, input.productCode),
      canonicalRefNum: null,
      activityType: input.activityType,
      bookMode: null,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.db
      .prepare(
        `INSERT INTO activity_products
           (product_id, project_id, collection_id, product_code, module_folder,
            canonical_ref_num, activity_type, book_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        product.productId,
        product.projectId,
        product.collectionId,
        product.productCode,
        product.moduleFolder,
        product.activityType,
        product.createdAt,
        product.updatedAt,
      );
    return product;
  }

  /** The product a ref belongs to, or null for a row predating the product level. */
  productOf(activity: ActivityRecord): ActivityProduct | null {
    if (!activity.productId) return null;
    const row = this.db
      .prepare("SELECT * FROM activity_products WHERE product_id = ?")
      .get(activity.productId) as Record<string, unknown> | undefined;
    return row ? this.mapProduct(row) : null;
  }

  /**
   * Whether this ref owns the module code.
   *
   * Only the canonical ref may change the shared module; the others are configuration on
   * top of it. Three generation stages are gated on this. A ref with no product at all
   * predates the product level and is treated as canonical, because it is the only ref
   * anyone could have been building against.
   */
  isCanonicalRef(activity: ActivityRecord): boolean {
    const product = this.productOf(activity);
    if (!product) return true;
    return product.canonicalRefNum === null || product.canonicalRefNum === activity.refNum;
  }

  /**
   * What an author calls a ref, and whether others may build against it.
   *
   * Neither belongs to the draft: renaming a ref does not change its content, so putting
   * them through the draft revision would make a label edit conflict with an unsaved
   * specification.
   */
  async setRefIdentity(
    projectId: string,
    activityId: string,
    identity: { displayName?: unknown; stable?: boolean },
  ): Promise<ActivityRecord> {
    let displayName: string | null | undefined;
    try {
      if (identity.displayName !== undefined)
        displayName = normalizeDisplayName(identity.displayName);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const activity = await this.getActivity(projectId, activityId);
        const now = new Date().toISOString();
        const next: ActivityRecord = {
          ...activity,
          displayName: displayName === undefined ? activity.displayName : displayName,
          stable: identity.stable === undefined ? activity.stable : identity.stable,
          updatedAt: now,
        };
        this.db
          .prepare(
            "UPDATE activities SET display_name = ?, stable = ?, updated_at = ? WHERE id = ?",
          )
          .run(next.displayName, next.stable ? 1 : 0, now, activityId);
        return next;
      }),
    );
  }

  /**
   * Give a ref another number within its product.
   *
   * Everything Penguin keeps for a ref is keyed by its id, so only the number itself, the
   * product's canonical number when this ref owns the module, and the media manifest's
   * address change. Module runs already assembled keep the old name as history; the next
   * assembly writes the new one.
   */
  async changeRefNum(
    projectId: string,
    activityId: string,
    refNum: unknown,
    expectedRevision: string,
  ): Promise<ActivityDetail> {
    let next: number;
    try {
      next = normalizeRefNum(refNum);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const collectionId = (await this.getActivity(projectId, activityId)).collectionId;
        // The create lock keeps a new ref from taking the number between check and write.
        return this.locks.run(`create:${collectionId}`, async () => {
          const current = await this.getActivity(projectId, activityId);
          if (next === current.refNum)
            throw new HttpError(400, "ref_unchanged", "The ref already has this number.");
          if (current.stable)
            throw new HttpError(
              409,
              "ref_stable",
              "This ref is marked stable, so others may build against its number. Clear Stable before renumbering.",
            );
          if (expectedRevision !== current.draft.contentRevision)
            throw new HttpError(
              409,
              "draft_conflict",
              "Draft changed. Reload it before renumbering the ref.",
            );
          if (
            this.db
              .prepare("SELECT 1 FROM activity_runs WHERE activity_id = ? AND status = 'running'")
              .get(activityId)
          )
            throw new HttpError(
              409,
              "run_active",
              "A run is still working on this ref under its current number. Stop it before renumbering.",
            );
          // Archived rows count: they keep their number, as creating a ref already honours.
          const taken = this.db
            .prepare(
              "SELECT archived FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ? AND id != ?",
            )
            .get(current.collectionId, current.productCode, next, activityId) as
            { archived: number } | undefined;
          if (taken)
            throw new HttpError(
              409,
              "activity_exists",
              taken.archived
                ? `A deleted ref of this product keeps number ${next}.`
                : `Another ref of this product already uses number ${next}.`,
            );
          const product = this.productOf(current);
          const wasCanonical = !!product && product.canonicalRefNum === current.refNum;
          const previous = current.draft;
          const now = new Date().toISOString();
          const draft: ActivityDraft = { ...previous, updatedAt: now };
          if (previous.mediaPlan) {
            const manifest = structuredClone(previous.mediaPlan.manifest);
            manifest.refNum = next;
            try {
              validateManifest(manifest, { productCode: current.productCode, refNum: next });
            } catch (error) {
              throw new HttpError(422, "media_invalid", (error as Error).message);
            }
            draft.mediaPlan = { ...previous.mediaPlan, manifest };
          }
          draft.contentRevision = draftRevision(draft);
          const index = (state: {
            refNum: number;
            draft: ActivityDraft;
            activityUpdatedAt: string;
            productUpdatedAt: string;
          }) => {
            this.db.exec("BEGIN");
            try {
              this.db
                .prepare("UPDATE activities SET ref_num = ?, updated_at = ? WHERE id = ?")
                .run(state.refNum, state.activityUpdatedAt, activityId);
              if (wasCanonical)
                this.db
                  .prepare(
                    "UPDATE activity_products SET canonical_ref_num = ?, updated_at = ? WHERE product_id = ?",
                  )
                  .run(state.refNum, state.productUpdatedAt, product!.productId);
              this.db
                .prepare(
                  "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
                )
                .run(
                  state.draft.contentRevision,
                  state.draft.status,
                  state.draft.updatedAt,
                  state.draft.draftId,
                );
              this.db.exec("COMMIT");
            } catch (error) {
              this.db.exec("ROLLBACK");
              throw error;
            }
          };
          index({ refNum: next, draft, activityUpdatedAt: now, productUpdatedAt: now });
          try {
            await this.writeDraft(projectId, draft, current.collectionId);
          } catch (error) {
            // draft.json is written last, so on disk the draft still names the old number;
            // the index goes back to it, and the exports are rewritten to match.
            index({
              refNum: current.refNum,
              draft: previous,
              activityUpdatedAt: current.updatedAt,
              productUpdatedAt: product?.updatedAt ?? now,
            });
            await this.writeDraft(projectId, previous, current.collectionId).catch(() => {});
            throw error;
          }
          return { ...current, refNum: next, updatedAt: now, draft };
        });
      }),
    );
  }

  /**
   * The number a new ref of this ref's product would take, the numbers already held (deleted
   * refs keep theirs), and whether this ref is the template new refs are made from.
   */
  async nextRefNumber(projectId: string, activityId: string): Promise<RefNumberSuggestion> {
    const activity = await this.getActivity(projectId, activityId);
    const taken = (
      this.db
        .prepare(
          "SELECT ref_num AS refNum FROM activities WHERE collection_id = ? AND product_code = ? ORDER BY ref_num",
        )
        .all(activity.collectionId, activity.productCode) as { refNum: number }[]
    ).map((row) => row.refNum);
    return {
      refNum: nextFreeRefNum(taken),
      canonical: !!activity.productId && this.isCanonicalRef(activity),
      taken,
    };
  }

  /**
   * A new ref of the template's product, made from the template: its description,
   * specification and media plan (addressed to the new number, with the author's decision
   * about each asset applied), and copies of its generated media, uploads and implementation
   * features. Checkout media stays shared by reference, since the checkout is never written.
   *
   * Only the product's canonical ref, marked stable, is a template. Everything the request
   * says is checked before the ref exists; a failure after that removes the ref's row and its
   * files again, so a refused create leaves nothing behind.
   */
  async createRefFromTemplate(
    projectId: string,
    templateId: string,
    input: { refNum: unknown; displayName?: unknown; decisions: RefAssetDecision[] },
  ): Promise<ActivityDetail> {
    let refNum: number;
    let displayName: string | null = null;
    try {
      refNum = normalizeRefNum(input.refNum);
      if (input.displayName !== undefined) displayName = normalizeDisplayName(input.displayName);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    return this.projectWork.run(projectId, () =>
      // The template's lock keeps its draft from changing while it is read and copied.
      this.locks.run(templateId, async () => {
        const template = await this.getActivity(projectId, templateId);
        if (!template.productId || !this.isCanonicalRef(template))
          throw new HttpError(
            409,
            "not_canonical",
            `Ref ${template.refNum} is not its product's template. Make new refs from the canonical ref.`,
          );
        if (!template.stable)
          throw new HttpError(
            409,
            "template_not_stable",
            `Ref ${template.refNum} is not marked stable. Mark it stable before making refs from it.`,
          );
        const planned = refDraftFromTemplate(template, refNum, input.decisions);
        const created = await this.createActivity(projectId, {
          collectionId: template.collectionId,
          productCode: template.productCode,
          refNum,
          title: template.title,
          activityType: template.activityType,
        });
        try {
          const target = this.activityWorkspace(projectId, created);
          await this.copyTemplateFiles(this.activityWorkspace(projectId, template), target);
          // A bound upload must be one of the files just copied, of the asset's kind.
          for (const decision of input.decisions) {
            if (decision.action !== "bind") continue;
            const asset = planned.mediaPlan?.manifest.assets[decision.language]?.find(
              (entry) => entry.key === decision.assetKey,
            );
            const mimeType = await readUpload(target, decision.path!).then(
              (file) => file.mimeType,
              () => null,
            );
            if (!mimeType)
              throw new HttpError(
                422,
                "ref_plan_invalid",
                `The template has no uploaded file ${decision.path}.`,
              );
            const kind = mimeType.slice(0, mimeType.indexOf("/"));
            const wanted =
              asset?.type === "image" ? "image" : asset?.type === "audio" ? "audio" : "video";
            if (kind !== wanted)
              throw new HttpError(
                422,
                "ref_plan_invalid",
                `Asset ${decision.assetKey} expects ${wanted} media, but ${decision.path} holds ${kind} media.`,
              );
          }
          await this.change(projectId, created.id, created.draft.contentRevision, (draft) => ({
            ...draft,
            ...planned,
          }));
          if (displayName) await this.setRefIdentity(projectId, created.id, { displayName });
          return await this.getActivity(projectId, created.id);
        } catch (error) {
          await this.discardCreatedRef(projectId, created).catch(() => {});
          throw error;
        }
      }),
    );
  }

  /** Copy a template's own files into a new ref's workspace, never following a link. */
  private async copyTemplateFiles(source: string, target: string): Promise<void> {
    await fs.mkdir(target, { recursive: true });
    for (const name of ["audio", "images", VIDEO_DIR, "media", IMPLEMENTATION_FEATURES_FILE]) {
      const from = path.join(source, name);
      const stat = await fs.lstat(from).catch(() => null);
      if (!stat || stat.isSymbolicLink()) continue;
      await fs.cp(from, path.join(target, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
        filter: async (entry) => !(await fs.lstat(entry)).isSymbolicLink(),
      });
    }
  }

  /** Remove a ref made moments ago whose making failed: its rows, then its files. */
  private async discardCreatedRef(projectId: string, activity: ActivityRecord): Promise<void> {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM activity_drafts WHERE activity_id = ?").run(activity.id);
      this.db.prepare("DELETE FROM activities WHERE id = ?").run(activity.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    await fs.rm(
      path.join(this.collectionDir(projectId, activity.collectionId), "activities", activity.id),
      { recursive: true, force: true },
    );
  }

  /**
   * Replace a product's tags, reached through any of its refs.
   *
   * Tags belong to the product, so every ref of it lists the same ones afterwards. A ref
   * predating the product level has nowhere to keep them.
   */
  async setProductTags(projectId: string, activityId: string, tags: unknown): Promise<string[]> {
    const next = normalizeTags(tags);
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      if (!activity.productId)
        throw new HttpError(409, "no_product", "This activity has no product to tag.");
      const productId = activity.productId;
      const now = new Date().toISOString();
      // One synchronous transaction: nothing else can interleave between the delete and
      // the inserts, so the product never shows half its tags.
      this.db.exec("BEGIN");
      try {
        this.db.prepare("DELETE FROM activity_product_tags WHERE product_id = ?").run(productId);
        const insert = this.db.prepare(
          "INSERT INTO activity_product_tags (product_id, tag, position) VALUES (?, ?, ?)",
        );
        next.forEach((tag, position) => insert.run(productId, tag, position));
        this.db
          .prepare("UPDATE activity_products SET updated_at = ? WHERE product_id = ?")
          .run(now, productId);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
      return next;
    });
  }

  /**
   * Delete an activity from the author's view by archiving it.
   *
   * Nothing on disk is removed: the row stays (every reader already skips archived ones)
   * and its drafts and media stay where they are, so a delete loses no work. A running
   * run is refused rather than orphaned, and a canonical ref is refused while other refs
   * still build on the module it owns.
   */
  async archiveActivity(projectId: string, activityId: string): Promise<void> {
    return this.projectWork.run(projectId, () =>
      this.locks.run(activityId, async () => {
        const activity = await this.getActivity(projectId, activityId);
        if (
          this.db
            .prepare("SELECT 1 FROM activity_runs WHERE activity_id = ? AND status = 'running'")
            .get(activityId)
        )
          throw new HttpError(
            409,
            "run_active",
            "A run is still working on this activity. Stop it before deleting the activity.",
          );
        const product = this.productOf(activity);
        if (
          product &&
          product.canonicalRefNum === activity.refNum &&
          this.db
            .prepare(
              "SELECT 1 FROM activities WHERE product_id = ? AND id != ? AND archived = 0 LIMIT 1",
            )
            .get(product.productId, activityId)
        )
          throw new HttpError(
            409,
            "canonical_has_refs",
            "Other refs of this product build on the module this one owns. Delete them first.",
          );
        this.db
          .prepare("UPDATE activities SET archived = 1, updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), activityId);
      }),
    );
  }

  /**
   * A book product's reading mode.
   *
   * It belongs to the product rather than to a ref: every ref of a book shares one module,
   * and a module is built either read-along or decodable, never both.
   */
  async setProductBookMode(
    projectId: string,
    collectionId: string,
    productCode: string,
    mode: "decodable" | "readAlong",
  ): Promise<ActivityProduct> {
    return this.projectWork.run(projectId, async () => {
      const row = this.db
        .prepare(
          "SELECT * FROM activity_products WHERE collection_id = ? AND product_code = ? AND project_id = ?",
        )
        .get(collectionId, productCode, projectId) as Record<string, unknown> | undefined;
      if (!row) throw new HttpError(404, "product_not_found", "No such product.");
      const product = this.mapProduct(row);
      if (product.activityType !== "book")
        throw new HttpError(400, "book_mode_invalid", "Reading mode only applies to books.");
      const now = new Date().toISOString();
      this.db
        .prepare("UPDATE activity_products SET book_mode = ?, updated_at = ? WHERE product_id = ?")
        .run(mode, now, product.productId);
      return { ...product, bookMode: mode, updatedAt: now };
    });
  }
}

/** Whether a stored draft's module document edits have the shape this server writes. */
function validModuleDocuments(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  // Only the kinds this server knows are checked; another kind is kept as it is and ignored.
  return (["configuration", "assessment"] as const).every((kind) => {
    const entry = (value as Record<string, unknown>)[kind] as Record<string, unknown> | undefined;
    return (
      entry === undefined ||
      (!!entry &&
        typeof entry === "object" &&
        !Array.isArray(entry) &&
        !!entry.value &&
        typeof entry.value === "object" &&
        !Array.isArray(entry.value) &&
        (entry.basis === null || typeof entry.basis === "string") &&
        typeof entry.editedAt === "string")
    );
  });
}
