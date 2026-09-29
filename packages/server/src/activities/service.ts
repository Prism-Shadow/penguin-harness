import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs/promises";
import { buildReadiness } from "./build-readiness.js";
import type { GeneratedAudioFormat, MediaAsset } from "./media.js";
import {
  IMPLEMENTATION_FEATURES,
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
import {
  generatedAudioExtension,
  generatedMediaPath,
  planMedia,
  validateManifest,
  validateMediaCoverage,
} from "./media.js";
import { inspectWebm, readVideoFile } from "./video-render.js";
import {
  candidateReference,
  copyRefMedia,
  mediaFile,
  readdressMedia,
  refMediaFolder,
  uploadHome,
  wavToMp3,
  writeSidecar,
  type AudioEncodePorts,
  type UploadHome,
} from "./ref-media.js";
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
import type { WafWorkspace } from "./waf-workspace.js";
import {
  productDir,
  readFeatureFile,
  readProductOwner,
  readRefDraft,
  refDir,
  refSpecDir,
  REF_FEATURES_FILE,
  writeFeatureFile,
  writeProductFiles,
  writeRefDraft,
  writeRefMetadata,
} from "./ref-files.js";
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
import { adoptLoomProduct, describeAdoption, type CarriedBinding } from "./loom-adopt.js";
import { mapProductMetadata, parseRefDirName, readLoomProduct } from "./loom-read.js";
import type { ClaimModuleProductResponse, ModuleProduct } from "./module-product-types.js";

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
  @Use() private readonly wafWorkspace!: WafWorkspace;
  @Use() private readonly audioEncode!: AudioEncodePorts;
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
    if (isUploadReference(bound)) return readUpload(await this.uploads(activity), bound!);
    return readBoundImage(activity, input, await this.wafWorkspace.root());
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
    assessment?: { current: unknown; own: unknown },
  ) {
    const activity = await this.getActivity(projectId, activityId);
    const checkout = await this.wafWorkspace.root();
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
    const stored = await readFeatureFile(await this.draftFilesDir(activity));
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
        const selection = normalizeFeatureSelection(selectedIds);
        await writeFeatureFile(await this.draftFilesDir(activity), selection);
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
      return storeUpload(await this.uploads(activity), name, bytes);
    });
  }
  async listMedia(projectId: string, activityId: string): Promise<UploadedMedia[]> {
    const activity = await this.getActivity(projectId, activityId);
    return listUploads(await this.uploads(activity));
  }
  async uploadContent(
    projectId: string,
    activityId: string,
    reference: string,
  ): Promise<{ bytes: Buffer; mimeType: string }> {
    const activity = await this.getActivity(projectId, activityId);
    return readUpload(await this.uploads(activity), reference);
  }
  /**
   * Every file uploaded to a live activity of this project, newest first. Only metadata is
   * read, as `listUploads` does for one activity. An archived activity is left out, and an
   * activity whose draft index is missing contributes nothing rather than failing the list.
   */
  async projectMedia(projectId: string): Promise<ProjectMediaListing> {
    const files: LibraryFile[] = [];
    const root = await this.requireWafRoot();
    for (const activity of await this.listActivities(projectId)) {
      for (const upload of await listUploads(
        uploadHome(root, activity.productCode, activity.refNum),
      ))
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
    const homes = new Map<string, UploadHome>();
    const files: { file: string; home: UploadHome; path: string }[] = [];
    let total = 0;
    for (const item of unique) {
      let home = homes.get(item.activityId);
      if (!home) {
        home = await this.uploads(await this.getActivity(projectId, item.activityId));
        homes.set(item.activityId, home);
      }
      // A path that is not an upload of this activity is simply not one of its files.
      let file: string | null = null;
      try {
        file = uploadFile(home, item.path);
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
      files.push({ file, home, path: item.path });
    }
    const names = bundleEntryNames(files.map((entry) => path.basename(entry.file)));
    const entries: Record<string, Uint8Array> = {};
    for (const [index, entry] of files.entries()) {
      const { bytes } = await readUpload(entry.home, entry.path);
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
    const source = await this.uploads(activity);
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

  async storeImage(
    projectId: string,
    activityId: string,
    runId: string,
    bytes: Uint8Array,
  ): Promise<ImageResult> {
    return this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const result = inspectPng(bytes, runId);
      await this.storeCandidate(activity, runId, "png", bytes);
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
      await this.generatedFile(activity, "generatedImage", runId, "png"),
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
    return this.change(projectId, activityId, expectedRevision, async (draft, activity) => {
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
      asset.path = generatedMediaPath(activity, target.language, asset, "png");
      asset.generatedImage = { runId: result.runId, sha256: result.sha256 };
      await this.acceptCandidate(activity, result.runId, "png", asset.path, {
        text: asset.description,
        model: "Penguin Harness",
      });
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
      await this.storeCandidate(activity, runId, "webm", bytes);
      return { runId, ...inspected };
    });
  }
  async discardVideo(projectId: string, activityId: string, runId: string): Promise<void> {
    await this.projectWork.run(projectId, async () => {
      const activity = await this.getActivity(projectId, activityId);
      const root = await this.requireWafRoot();
      const reference = candidateReference(activity.productCode, activity.refNum, runId, "webm");
      await fs.rm(mediaFile(root, reference)!, { force: true });
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
      bytes = await readVideoFile(
        await this.generatedFile(activity, "generatedVideo", runId, "webm"),
      );
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
    return this.change(projectId, activityId, expectedRevision, async (draft, activity) => {
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
      asset.path = generatedMediaPath(activity, target.language, asset, "webm");
      asset.generatedVideo = { runId: result.runId, sha256: result.sha256 };
      await this.acceptCandidate(activity, result.runId, "webm", asset.path, null);
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
   * The file behind a bound recording's media path, for the player to serve, or null when the
   * path is not a recording this draft binds.
   */
  async boundVideoFile(projectId: string, activityId: string, mediaPath: string) {
    const activity = await this.getActivity(projectId, activityId);
    const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
      .flat()
      .find((asset) => asset.generatedVideo && asset.path === mediaPath)?.generatedVideo;
    return bound ? mediaFile(await this.requireWafRoot(), mediaPath) : null;
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
        const known = this.db
          .prepare(
            "SELECT module_folder FROM activity_products WHERE collection_id = ? AND product_code = ?",
          )
          .get(collection.collectionId, productCode) as { module_folder: string } | undefined;
        // Checked before anything is indexed, so a refusal leaves no product row behind.
        await this.claimModuleFolder(
          projectId,
          known?.module_folder ?? normalizeModuleFolder(input.moduleFolder, productCode),
          productCode,
          refNum,
        );
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
        await this.writeDraft(activity, draft);
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
          await fs.rm(path.dirname(await this.draftFilesDir(activity)), {
            recursive: true,
            force: true,
          });
          throw error;
        }
        await this.syncProductFiles(activity.productId!);
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
    const filesDir = await this.draftFilesDir(activity);
    const stored =
      (await readRefDraft(filesDir)) ??
      (await this.moveLegacyDraft(projectId, activity, draftRow.draft_id, filesDir));
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
      // rewrites the ref's files, so a read in between (or after a crash there) finds the
      // old number in the manifest; it is read under the row's number, and the next save
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
        const home = await this.uploads(activity);
        for (const assets of Object.values(parsed.assets))
          for (const asset of assets) {
            if (!isUploadReference(asset.path)) continue;
            const { mimeType } = await readUpload(home, asset.path!);
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
      // The media repository keeps audio as MP3, as Loom kept it; a WAV take is converted.
      const mp3 = format === "mp3" ? bytes : await (this.audioEncode.wavToMp3 ?? wavToMp3)(bytes);
      const result = inspectGeneratedAudio(mp3, runId, "mp3");
      await this.storeCandidate(activity, runId, "mp3", mp3);
      return { ...result, format: "mp3" };
    });
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
      await this.generatedFile(
        activity,
        "generatedAudio",
        runId,
        generatedAudioExtension({ format }),
      ),
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
    return this.change(projectId, activityId, expectedRevision, async (draft, activity) => {
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
      asset.path = generatedMediaPath(
        activity,
        target.language,
        asset,
        generatedAudioExtension(generated),
      );
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
      await this.acceptCandidate(
        activity,
        result.runId,
        generatedAudioExtension(generated),
        asset.path,
        {
          text: asset.script ?? "",
          model: "Penguin Harness",
          ...(asset.voice ? { voice: asset.voice } : {}),
          ...(asset.wordTimings ? { wordTimings: asset.wordTimings } : {}),
          ...(asset.durationMs !== undefined ? { durationMs: asset.durationMs } : {}),
        },
      );
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
        // Saved under another number, its media is where that number named it; the restore
        // writes it back under this ref's folder (see ActivityVersionService.restore).
        readdressMedia(
          plan.manifest.assets,
          refMediaFolder(activity.productCode, plan.manifest.refNum),
          refMediaFolder(activity.productCode, activity.refNum),
        );
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
      const title = draft.status === "valid" ? (draft.spec!.title as string) : current.title;
      await this.writeDraft({ ...current, title }, draft);
      this.db
        .prepare(
          "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
        )
        .run(draft.contentRevision, draft.status, draft.updatedAt, draft.draftId);
      this.db
        .prepare("UPDATE activities SET title = ?, updated_at = ? WHERE id = ?")
        .run(title, draft.updatedAt, activityId);
      if (title !== current.title && this.isCanonicalRef(current) && current.productId)
        await this.syncProductFiles(current.productId);
      return draft;
    });
  }
  /**
   * A draft saved before activities were stored in their modules, written into the ref's
   * module files the first time it is read. The old `draft.json` is left where it was, as a
   * copy. Files already at the ref's address in the module (Loom's, or anything else) are
   * never overwritten: the read is refused, naming both places.
   */
  private async moveLegacyDraft(
    projectId: string,
    activity: ActivityRecord,
    draftId: string,
    filesDir: string,
  ): Promise<ActivityDraft> {
    return this.locks.run(`legacy:${activity.id}`, async () => {
      const again = await readRefDraft(filesDir);
      if (again) return again;
      const workspace = this.draftWorkspace(projectId, activity.collectionId, activity.id, draftId);
      const text = await fs.readFile(path.join(workspace, "draft.json"), "utf8").catch(() => null);
      if (text === null) throw new Error("Activity draft is missing from its module.");
      const refFolder = path.dirname(filesDir);
      if (await exists(refFolder))
        throw new HttpError(
          409,
          "ref_files_conflict",
          `The module already has files for ${activity.productCode}-${activity.refNum} at ${refFolder}; this ref's earlier draft was left in ${workspace}.`,
        );
      const product = this.productOf(activity);
      await this.claimModuleFolder(
        projectId,
        this.moduleFolderOf(activity),
        activity.productCode,
        activity.refNum,
      );
      const legacy = JSON.parse(text) as ActivityDraft;
      await this.writeDraft(activity, legacy);
      const features = await fs
        .readFile(path.join(workspace, "implementation-features.json"), "utf8")
        .then(
          (value) => JSON.parse(value) as { selectedIds?: unknown },
          () => null,
        );
      if (features)
        await writeFeatureFile(filesDir, normalizeFeatureSelection(features.selectedIds));
      if (product) await this.syncProductFiles(product.productId);
      return legacy;
    });
  }

  /**
   * The ref's draft into its module's files, with its identity beside it. The folder is the
   * ref's address, so `activity` must carry the number the files are to be under.
   */
  private async writeDraft(activity: ActivityRecord, draft: ActivityDraft): Promise<void> {
    const dir = await this.draftFilesDir(activity);
    await writeRefDraft(dir, draft);
    await writeRefMetadata(dir, {
      productCode: activity.productCode,
      refNum: activity.refNum,
      title: activity.title,
      moduleFolder: this.moduleFolderOf(activity),
      displayName: activity.displayName,
      stable: activity.stable,
      ...(draft.spec?.runtime !== undefined ? { runtime: draft.spec.runtime } : {}),
    });
  }

  /**
   * The files its number names, from where they are for `from` to where they go for `to`:
   * the ref's folder in its module, the module's configuration and assessment, and the ref's
   * media folder in the media repository.
   */
  private async refNumberFiles(
    from: ActivityRecord,
    to: ActivityRecord,
  ): Promise<{ from: string; to: string }[]> {
    const root = await this.requireWafRoot();
    const module = path.join(root, "modules", this.moduleFolderOf(from));
    const named = (ref: ActivityRecord, folder: string) =>
      path.join(module, folder, `${ref.productCode}-${ref.refNum}.json`);
    const media = (ref: ActivityRecord) =>
      mediaFile(root, refMediaFolder(ref.productCode, ref.refNum))!;
    return [
      {
        from: path.dirname(await this.draftFilesDir(from)),
        to: path.dirname(await this.draftFilesDir(to)),
      },
      { from: named(from, "configurations"), to: named(to, "configurations") },
      { from: named(from, "assessments"), to: named(to, "assessments") },
      { from: media(from), to: media(to) },
    ];
  }

  /** The ref's uploads, in its media folder in the media repository. */
  private async uploads(activity: ActivityRecord): Promise<UploadHome> {
    return uploadHome(await this.requireWafRoot(), activity.productCode, activity.refNum);
  }

  /** Writes a generation's take into the ref's candidates, in the media repository. */
  private async storeCandidate(
    activity: ActivityRecord,
    runId: string,
    extension: string,
    bytes: Uint8Array,
  ): Promise<void> {
    const reference = candidateReference(activity.productCode, activity.refNum, runId, extension);
    const file = mediaFile(await this.requireWafRoot(), reference)!;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, bytes, { flag: "wx" });
  }

  /**
   * A generated take of this ref: its candidate while it waits, and once accepted, the file
   * the manifest binds to that run. A path that is neither is returned as the candidate's, so
   * the reader reports it missing.
   */
  private async generatedFile(
    activity: ActivityDetail,
    field: "generatedImage" | "generatedAudio" | "generatedVideo",
    runId: string,
    extension: string,
  ): Promise<string> {
    const root = await this.requireWafRoot();
    const reference = candidateReference(activity.productCode, activity.refNum, runId, extension);
    const candidate = mediaFile(root, reference)!;
    if (await exists(candidate)) return candidate;
    const bound = Object.values(activity.draft.mediaPlan?.manifest.assets ?? {})
      .flat()
      .find((asset) => asset[field]?.runId === runId && asset.path);
    return (bound && mediaFile(root, bound.path!)) || candidate;
  }

  /**
   * An accepted take, copied from its candidate to the path the asset is bound to (replacing
   * the file there), with Loom's sidecar beside it. The candidate goes once the copy is there.
   */
  private async acceptCandidate(
    activity: ActivityRecord,
    runId: string,
    extension: string,
    reference: string,
    sidecar: Parameters<typeof writeSidecar>[1] | null,
  ): Promise<void> {
    const root = await this.requireWafRoot();
    const candidate = mediaFile(
      root,
      candidateReference(activity.productCode, activity.refNum, runId, extension),
    )!;
    const target = mediaFile(root, reference);
    if (!target) throw new HttpError(400, "media_path_invalid", "The media path is invalid.");
    // Accepted already (the same take accepted twice): the file is where it belongs.
    if (!(await exists(candidate))) return;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(candidate, target);
    if (sidecar) await writeSidecar(target, sidecar);
    await fs.rm(candidate, { force: true });
  }

  /** The WAF workspace's root; every ref's files are in its modules. */
  private async requireWafRoot(): Promise<string> {
    return this.wafWorkspace.requireRoot();
  }

  private moduleFolderOf(activity: ActivityRecord): string {
    return (
      this.productOf(activity)?.moduleFolder ??
      normalizeModuleFolder(undefined, activity.productCode)
    );
  }

  /** `generated/<pc>/refs/<pc>-<ref>/spec` in the ref's module: where its draft is. */
  async draftFilesDir(activity: ActivityRecord): Promise<string> {
    return refSpecDir(
      await this.requireWafRoot(),
      this.moduleFolderOf(activity),
      activity.productCode,
      activity.refNum,
    );
  }

  /**
   * Makes sure a new ref may be written into its module: the module is there (cloned, or
   * made in an existing checkout), no other project owns the product, and no files are
   * already at the ref's address.
   */
  private async claimModuleFolder(
    projectId: string,
    moduleFolder: string,
    productCode: string,
    refNum: number,
  ): Promise<void> {
    const root = await this.requireWafRoot();
    await this.wafWorkspace.authoringModule(moduleFolder);
    // The product's media folder, checked out of the partial media clone with its LFS files.
    await this.wafWorkspace.ensureMedia([`loom/${productCode}`]);
    const dir = productDir(root, moduleFolder, productCode);
    const owner = await readProductOwner(dir);
    if (owner && owner.projectId !== projectId)
      throw new HttpError(
        409,
        "product_taken",
        `Product ${productCode} belongs to another project.`,
      );
    const ref = refDir(root, moduleFolder, productCode, refNum);
    if (await exists(ref))
      throw new HttpError(
        409,
        "activity_exists",
        `Ref ${refNum} of ${productCode} already has files in its module.`,
      );
    // Media already at the ref's address (Loom's, say) is someone else's, not this ref's.
    if (await exists(mediaFile(root, refMediaFolder(productCode, refNum))!))
      throw new HttpError(
        409,
        "activity_exists",
        `Ref ${refNum} of ${productCode} already has media in the media repository.`,
      );
  }

  /** The product's metadata and owner in its module, as the index has them now. */
  private async syncProductFiles(productId: string): Promise<void> {
    const row = this.db
      .prepare("SELECT * FROM activity_products WHERE product_id = ?")
      .get(productId) as Record<string, unknown> | undefined;
    if (!row) return;
    const product = this.mapProduct(row);
    const canonical =
      product.canonicalRefNum === null
        ? undefined
        : (this.db
            .prepare(
              "SELECT title FROM activities WHERE product_id = ? AND ref_num = ? AND archived = 0",
            )
            .get(productId, product.canonicalRefNum) as { title: string } | undefined);
    await writeProductFiles(
      productDir(await this.requireWafRoot(), product.moduleFolder, product.productCode),
      {
        productCode: product.productCode,
        title: canonical?.title ?? product.productCode,
        moduleFolder: product.moduleFolder,
        activityType: product.activityType,
        bookMode: product.bookMode,
        canonicalRefNum: product.canonicalRefNum,
        tags: this.productTags(productId),
      },
      {
        schemaVersion: 1,
        projectId: product.projectId,
        productId: product.productId,
        collectionId: product.collectionId,
      },
    );
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
        await this.writeDraft(next, activity.draft);
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
            // The ref's media folder is named by its number and moves with it (below).
            readdressMedia(
              manifest.assets,
              refMediaFolder(current.productCode, current.refNum),
              refMediaFolder(current.productCode, next),
            );
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
          // The ref's folder is named by its number, so the files move before anything
          // names the new number; a folder already there belongs to something else.
          // Everything in the module named by the ref's number moves with it, as Loom's
          // renamer moved it: the ref's folder, and its configuration and assessment. A
          // target already there belongs to something else, so nothing moves.
          const moved = { ...current, refNum: next, updatedAt: now };
          const moves = await this.refNumberFiles(current, moved);
          for (const move of moves)
            if (await exists(move.to))
              throw new HttpError(
                409,
                "activity_exists",
                `Ref ${next} of ${current.productCode} already has files in its module.`,
              );
          const done: typeof moves = [];
          const undo = async () => {
            for (const move of done.reverse()) await fs.rename(move.to, move.from).catch(() => {});
          };
          try {
            for (const move of moves) {
              if (!(await exists(move.from))) continue;
              await fs.rename(move.from, move.to);
              done.push(move);
            }
          } catch (error) {
            await undo();
            throw error;
          }
          index({ refNum: next, draft, activityUpdatedAt: now, productUpdatedAt: now });
          try {
            await this.writeDraft(moved, draft);
          } catch (error) {
            // penguin.json is written last, so the files still name the old number; the
            // index and the files go back to it.
            index({
              refNum: current.refNum,
              draft: previous,
              activityUpdatedAt: current.updatedAt,
              productUpdatedAt: product?.updatedAt ?? now,
            });
            await undo();
            await this.writeDraft(current, previous).catch(() => {});
            throw error;
          }
          if (wasCanonical) await this.syncProductFiles(product!.productId);
          return { ...moved, draft };
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
        // The template's media folder is copied to the new ref's (refDraftFromTemplate has
        // re-addressed the plan to it), and so is an upload a decision binds.
        const fromFolder = refMediaFolder(template.productCode, template.refNum);
        const toFolder = refMediaFolder(template.productCode, refNum);
        const moved = (reference: string) =>
          reference.startsWith(`${fromFolder}/`)
            ? `${toFolder}${reference.slice(fromFolder.length)}`
            : reference;
        const created = await this.createActivity(projectId, {
          collectionId: template.collectionId,
          productCode: template.productCode,
          refNum,
          title: template.title,
          activityType: template.activityType,
        });
        try {
          const target = await this.uploads(created);
          await copyRefMedia(await this.requireWafRoot(), fromFolder, toFolder);
          const features = path.join(await this.draftFilesDir(template), REF_FEATURES_FILE);
          if (await exists(features))
            await fs.copyFile(
              features,
              path.join(await this.draftFilesDir(created), REF_FEATURES_FILE),
            );
          // A bound upload must be one of the files just copied, of the asset's kind.
          for (const decision of input.decisions) {
            if (decision.action !== "bind") continue;
            const asset = planned.mediaPlan?.manifest.assets[decision.language]?.find(
              (entry) => entry.key === decision.assetKey,
            );
            const mimeType = await readUpload(target, moved(decision.path!)).then(
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
    await fs.rm(path.dirname(await this.draftFilesDir(activity)), { recursive: true, force: true });
    const media = mediaFile(
      await this.requireWafRoot(),
      refMediaFolder(activity.productCode, activity.refNum),
    );
    if (media) await fs.rm(media, { recursive: true, force: true });
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
      await this.syncProductFiles(productId);
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
      await this.syncProductFiles(product.productId);
      return { ...product, bookMode: mode, updatedAt: now };
    });
  }

  /**
   * The products in the WAF workspace's modules no project has open: what a Loom-authored
   * module holds under `generated/`, and a product this project owned before its index was
   * lost. Read from each product's metadata and its refs' folders only.
   */
  async moduleProducts(projectId: string): Promise<ModuleProduct[]> {
    const modules = path.join(await this.requireWafRoot(), "modules");
    const indexed = new Set(
      (
        this.db
          .prepare("SELECT module_folder AS folder, product_code AS code FROM activity_products")
          .all() as { folder: string; code: string }[]
      ).map((row) => `${row.folder}\u0000${row.code}`),
    );
    const found: ModuleProduct[] = [];
    const folders = await fs.readdir(modules, { withFileTypes: true }).catch(() => []);
    for (const folder of folders
      .filter((entry) => entry.isDirectory())
      .map((e) => e.name)
      .sort()) {
      const generated = path.join(modules, folder, "generated");
      const codes = await fs.readdir(generated, { withFileTypes: true }).catch(() => []);
      for (const code of codes
        .filter((entry) => entry.isDirectory())
        .map((e) => e.name)
        .sort()) {
        if (indexed.has(`${folder}\u0000${code}`)) continue;
        const dir = path.join(generated, code);
        const owner = await readProductOwner(dir).catch(() => null);
        if (owner && owner.projectId !== projectId) continue;
        const metadata = mapProductMetadata(
          code,
          folder,
          await fs
            .readFile(path.join(dir, "spec", "activity_metadata.json"), "utf8")
            .then((text) => JSON.parse(text) as unknown)
            .catch(() => null),
        );
        const refNums = (await fs.readdir(path.join(dir, "refs")).catch(() => [] as string[]))
          .map((name) => parseRefDirName(code, name))
          .filter((refNum): refNum is number => refNum !== null)
          .sort((left, right) => left - right);
        if (!refNums.length) continue;
        found.push({
          moduleFolder: folder,
          productCode: code,
          title: metadata.title,
          activityType: metadata.activityType,
          refNums,
        });
      }
    }
    return found;
  }

  /**
   * Opens a product that is in the modules into this project, in place: the product and its
   * refs are indexed, the project is recorded as its owner, and each ref Loom authored gets
   * Penguin's files beside Loom's. Loom's specification is used as it is (its module folder
   * repaired), the media plan is made from it again and Loom's bindings carried onto it, and
   * Loom's own specification and manifest are kept as `*.loom.json`. A ref Penguin already
   * wrote (this project's, before its index was lost) keeps its draft and ids.
   */
  async claimModuleProduct(
    projectId: string,
    input: { moduleFolder: string; productCode: string; collectionId?: string },
  ): Promise<ClaimModuleProductResponse> {
    const root = await this.requireWafRoot();
    const moduleFolder = normalizeModuleFolder(input.moduleFolder, input.productCode);
    let productCode: string;
    try {
      productCode = normalizeProductCode(input.productCode);
    } catch (error) {
      throw new HttpError(400, "activity_invalid", (error as Error).message);
    }
    const dir = productDir(root, moduleFolder, productCode);
    // One claim of a product at a time: two would both find it unowned.
    return this.locks.run(`claim:${moduleFolder}/${productCode}`, () =>
      this.claimLocked(projectId, root, dir, moduleFolder, productCode, input.collectionId),
    );
  }

  private async claimLocked(
    projectId: string,
    root: string,
    dir: string,
    moduleFolder: string,
    productCode: string,
    collectionId: string | undefined,
  ): Promise<ClaimModuleProductResponse> {
    if (!(await exists(path.join(dir, "refs"))))
      throw new HttpError(404, "module_product_not_found", "No such product in the modules.");
    const owner = await readProductOwner(dir);
    if (owner && owner.projectId !== projectId)
      throw new HttpError(
        409,
        "product_taken",
        `Product ${productCode} belongs to another project.`,
      );
    if (
      this.db
        .prepare("SELECT 1 FROM activity_products WHERE module_folder = ? AND product_code = ?")
        .get(moduleFolder, productCode)
    )
      throw new HttpError(409, "product_open", `Product ${productCode} is already open.`);
    const read = await readLoomProduct(path.join(root, "modules"), moduleFolder, productCode);
    if (!read.refs.length)
      throw new HttpError(404, "module_product_not_found", "This product has no refs.");
    const adoption = adoptLoomProduct(read.product, read.refs);
    const collection = await this.ensureCollection(projectId, collectionId);
    if (
      this.db
        .prepare("SELECT 1 FROM activity_products WHERE collection_id = ? AND product_code = ?")
        .get(collection.collectionId, productCode)
    )
      throw new HttpError(
        409,
        "activity_exists",
        `This project already has a product ${productCode}, in another module.`,
      );
    const problems = [
      ...read.problems,
      ...read.refs.flatMap((ref) => ref.problems.map((problem) => `Ref ${ref.refNum}: ${problem}`)),
    ];
    const now = new Date().toISOString();
    const product: ActivityProduct = {
      productId: owner?.productId ?? newId("prd"),
      projectId,
      collectionId: collection.collectionId,
      productCode,
      moduleFolder,
      canonicalRefNum: adoption.product.canonicalRefNum,
      activityType: adoption.product.activityType,
      bookMode: adoption.product.bookMode,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO activity_products
           (product_id, project_id, collection_id, product_code, module_folder,
            canonical_ref_num, activity_type, book_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        product.productId,
        projectId,
        product.collectionId,
        productCode,
        moduleFolder,
        product.canonicalRefNum,
        product.activityType,
        product.bookMode,
        now,
        now,
      );
    const activityIds: string[] = [];
    for (const mapped of adoption.activities) {
      const specDir = refSpecDir(root, moduleFolder, productCode, mapped.refNum);
      const penguin = await readRefDraft(specDir).catch(() => null);
      const activity: ActivityRecord = {
        id: penguin?.activityId ?? newId("act"),
        collectionId: collection.collectionId,
        productId: product.productId,
        productCode,
        refNum: mapped.refNum,
        title: mapped.title,
        displayName: mapped.displayName,
        stable: mapped.stable,
        activityType: product.activityType,
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: [],
      };
      const draftId = penguin?.draftId ?? newId("draft");
      this.db
        .prepare(
          "INSERT INTO activities (id, collection_id, product_id, product_code, ref_num, title, display_name, stable, activity_type, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)",
        )
        .run(
          activity.id,
          activity.collectionId,
          product.productId,
          productCode,
          mapped.refNum,
          activity.title,
          activity.displayName,
          activity.stable ? 1 : 0,
          activity.activityType,
          now,
          now,
        );
      this.db
        .prepare(
          "INSERT INTO activity_drafts (draft_id, activity_id, base_version_id, content_revision, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
        )
        .run(
          draftId,
          activity.id,
          penguin?.contentRevision ?? contentRevision({ description: "", spec: null }),
          penguin?.status ?? "draft",
          now,
        );
      activityIds.push(activity.id);
      if (penguin) continue;
      try {
        await this.adoptLoomRef(projectId, activity, draftId, specDir, mapped);
      } catch (error) {
        problems.push(`Ref ${mapped.refNum}: ${(error as Error).message}`);
      }
    }
    await this.syncProductFiles(product.productId);
    return {
      collectionId: collection.collectionId,
      activityIds,
      message: describeAdoption(adoption),
      problems,
    };
  }

  /**
   * Gives one Loom-authored ref Penguin's files: Loom's specification and manifest are kept
   * as `*.loom.json`, an empty draft is written, and then the specification, media plan and
   * Loom's bindings are applied through the ordinary authoring calls, so an adopted ref is
   * checked exactly as one made here is.
   */
  private async adoptLoomRef(
    projectId: string,
    activity: ActivityRecord,
    draftId: string,
    specDir: string,
    mapped: {
      description: string;
      spec: Record<string, unknown> | null;
      media: Record<string, CarriedBinding[]>;
    },
  ): Promise<void> {
    for (const name of ["activity_spec", "asset_manifest"]) {
      const from = path.join(specDir, `${name}.json`);
      const to = path.join(specDir, `${name}.loom.json`);
      if ((await exists(from)) && !(await exists(to))) await fs.copyFile(from, to);
    }
    const now = new Date().toISOString();
    const empty: ActivityDraft = {
      draftId,
      activityId: activity.id,
      baseVersionId: null,
      contentRevision: contentRevision({ description: mapped.description, spec: null }),
      status: "draft",
      description: mapped.description,
      spec: null,
      updatedAt: now,
    };
    empty.contentRevision = draftRevision(empty);
    await this.writeDraft(activity, empty);
    this.db
      .prepare(
        "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
      )
      .run(empty.contentRevision, empty.status, now, draftId);
    if (!mapped.spec) return;
    const specified = await this.applySpec(
      projectId,
      activity.id,
      mapped.spec,
      empty.contentRevision,
    );
    if (specified.status !== "valid" || !Object.keys(mapped.media).length) return;
    await this.carryLoomMedia(projectId, activity.id, mapped.media, specified.contentRevision);
  }

  /**
   * The media plan made from the ref's specification, with Loom's bindings carried onto it. A
   * language Loom held besides the default holds what Loom listed for it; the rest falls
   * back to the default.
   */
  private async carryLoomMedia(
    projectId: string,
    activityId: string,
    media: Record<string, CarriedBinding[]>,
    expectedRevision: string,
  ): Promise<ActivityDraft> {
    const planned = await this.planMedia(projectId, activityId, expectedRevision);
    const manifest = structuredClone(planned.mediaPlan!.manifest);
    const defaults = manifest.assets[DEFAULT_LANGUAGE_CODE] ?? [];
    const sceneIds = new Set(
      ((planned.spec?.scenes ?? planned.spec?.stages ?? []) as { id?: unknown }[]).map((scene) =>
        String(scene.id),
      ),
    );
    for (const [language, bindings] of Object.entries(media)) {
      const byKey = new Map(bindings.map((binding) => [binding.key, binding]));
      const listed = (asset: MediaAsset) =>
        byKey.has(asset.key) || (!!asset.sourceKey && byKey.has(asset.sourceKey));
      const base =
        language === DEFAULT_LANGUAGE_CODE
          ? defaults
          : defaults.filter(listed).map((asset) => {
              const {
                script: _script,
                path: _path,
                generatedAudio: _audio,
                generatedImage: _image,
                generatedVideo: _video,
                translatedFrom: _from,
                wordTimings: _timings,
                durationMs: _duration,
                ...rest
              } = structuredClone(asset);
              return rest;
            });
      manifest.assets[language] = base.map((asset) => {
        const binding = byKey.get(asset.key) ?? (asset.sourceKey && byKey.get(asset.sourceKey));
        if (!binding) return asset;
        return {
          ...asset,
          ...(binding.path ? { path: binding.path } : {}),
          ...(asset.type === "audio" && binding.script !== undefined
            ? { script: binding.script }
            : {}),
          ...(asset.type === "audio" && binding.wordTimings
            ? { wordTimings: binding.wordTimings }
            : {}),
          ...(asset.type === "audio" && binding.durationMs !== undefined
            ? { durationMs: binding.durationMs }
            : {}),
          ...(asset.type === "audio" && binding.playback ? binding.playback : {}),
          ...(asset.type === "audio" && binding.playback && binding.targetDurationMs !== undefined
            ? { targetDurationMs: binding.targetDurationMs }
            : {}),
        };
      });
      // A decodable book's word pronunciations are planned from its narration, not its
      // specification, so they are carried as Loom had them, in the scenes that still exist.
      const present = new Set(manifest.assets[language]!.map((asset) => asset.key));
      for (const binding of bindings) {
        const word = binding.bookWord;
        if (!word || present.has(binding.key)) continue;
        present.add(binding.key);
        manifest.assets[language]!.push({
          key: binding.key,
          type: "audio",
          role: "bookWord",
          description: `Pronunciation of “${word.word}”.`,
          word: word.word,
          normalizedWord: word.normalizedWord,
          ...(word.phonemes
            ? { phonemes: word.phonemes, phonemeSource: word.customized ? "author" : "espeak" }
            : {}),
          ...(word.customized ? { customized: true } : {}),
          ...(binding.path ? { path: binding.path } : {}),
          ...(binding.script !== undefined ? { script: binding.script } : {}),
          ...(binding.wordTimings ? { wordTimings: binding.wordTimings } : {}),
          ...(binding.durationMs !== undefined ? { durationMs: binding.durationMs } : {}),
          usages: word.usages.filter(
            (usage) =>
              sceneIds.has(usage.sceneId) &&
              /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(usage.sourceKey) &&
              usage.occurrence >= 1 &&
              usage.sceneOccurrenceCount >= usage.occurrence,
          ),
        });
      }
    }
    return this.applyMedia(projectId, activityId, manifest, planned.contentRevision);
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

/** Whether anything is at `file`. */
async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}
