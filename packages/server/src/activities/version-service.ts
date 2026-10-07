/**
 * Saved versions of an activity: save one, list them, say which one the draft holds now,
 * compare one with the draft or another version, and restore one.
 *
 * Storage is Penguin's own (version-store.ts): a row per version and content-addressed blobs
 * in the activity's directory, holding the version manifest and the bytes of every medium
 * Penguin owns. Checkout media is recorded by path only. A save whose content equals the
 * latest version's makes no new version and returns that one.
 *
 * A restore rolls forward: it keeps the draft as it was as an automatic version first, writes
 * the version's files and content back, and records the result as a new `restore` version.
 * An agent's proposal is applied the same way: the draft as it was is kept first.
 *
 * A finished QA or PROD deploy (the deploy events hook) keeps the draft as a `deploy` version,
 * or marks the latest one when nothing changed, and `status` says whether the draft has
 * changed since. After each new version, automatic versions beyond the newest 20 are removed
 * (version-retention.ts), with every blob no remaining version references.
 */
import { REF_FEATURES_FILE } from "./ref-files.js";
import fs from "node:fs/promises";
import path from "node:path";
import { Component, Interface, Use, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../hmr/capabilities.js";
import { HttpError } from "../http/errors.js";
import type { ActivityAuthoring, ActivityGeneration } from "../mechanisms/activities.js";
import { ActivityDeployEvents } from "./deploy-events.js";
import type { DeployedEvent } from "./deploy-types.js";
import { draftRevision, newId, type ActivityDetail, type ActivityDraft } from "./domain.js";
import { playingBuild } from "./module-builds.js";
import { normalizeFeatureSelection } from "./implementation-features.js";
import { validateManifest } from "./media.js";
import { withinRoot } from "./sandbox-paths.js";
import { versionDiff } from "./version-diff.js";
import {
  manifestBytes,
  manifestHash,
  mediaBytes,
  ownedMediaPaths,
  versionManifest,
  type VersionManifest,
  type VersionMedia,
} from "./version-manifest.js";
import { readdressMedia, refMediaFolder } from "./ref-media.js";
import type { WafWorkspace } from "./waf-workspace.js";
import { prunableVersions } from "./version-retention.js";
import {
  blobFile,
  blobsDir,
  deleteVersions,
  getVersion,
  isBlobName,
  latestVersion,
  listVersions,
  markVersionDeployed,
  readBlob,
  sha256,
  summarizeVersion,
  writeBlob,
  writeVersion,
  type VersionRow,
} from "./version-store.js";
import type {
  DeployDrift,
  DeployedVersion,
  VersionDiff,
  VersionKind,
  VersionReason,
  VersionSaveResult,
  VersionStatus,
  VersionSummary,
} from "./version-types.js";

export type {
  VersionDiff,
  VersionKind,
  VersionReason,
  VersionSaveResult,
  VersionStatus,
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
  /**
   * What differs going from version `versionId` to `against`: the draft as it is now
   * ("current") or another version of the activity.
   */
  diff(
    projectId: string,
    activityId: string,
    versionId: string,
    against: string,
  ): Promise<VersionDiff>;
  /**
   * Make the draft equal version `versionId`, keeping the draft as it was as an automatic
   * version first and recording the result as a `restore` version. Every file of the version
   * is checked before anything changes. Returns the draft.
   */
  restore(
    projectId: string,
    activityId: string,
    versionId: string,
    expectedRevision: string,
    author: string | null,
  ): Promise<ActivityDraft>;
  /**
   * Run `change`, a change that replaces a lot of the draft at once (an agent's whole
   * proposal), keeping the draft as it was first as an automatic version. Both happen while
   * nothing else changes the activity; `change` may change the draft through
   * `ActivityAuthoring` with an expected revision. A draft whose revision is not
   * `expectedRevision` is refused (409) before anything is kept. When `change` fails the
   * version stays; it holds the draft as it still is.
   */
  keepBefore<T>(
    projectId: string,
    activityId: string,
    input: { reason: VersionReason; author: string | null; expectedRevision: string },
    change: () => Promise<T>,
  ): Promise<T>;
  /**
   * Record a finished deploy: the draft is kept as a `deploy` version (or the latest version,
   * when it holds the same) and marked as the one on the target. When the draft changed after
   * the deploy took it, the newest version that holds what went is marked instead; null when
   * none does.
   */
  markDeployed(event: DeployedEvent): Promise<VersionSummary | null>;
  /** Whether QA and PROD hold what the draft holds now. */
  status(projectId: string, activityId: string): Promise<VersionStatus>;
}>() {}

@Component()
export class ActivityVersionService implements ActivityVersions {
  @Use() private readonly authoring!: ActivityAuthoring;
  @Use() private readonly generation!: ActivityGeneration;
  @Use() private readonly deployEvents!: ActivityDeployEvents;
  @Use() private readonly db!: Db;
  @Use() private readonly wafWorkspace!: WafWorkspace;

  /** The WAF root a version's media paths are relative to. */
  private async wafRoot(): Promise<string> {
    return this.wafWorkspace.requireRoot();
  }
  /** Digests of files already read, by path, size and modification time. */
  private readonly digests = new Map<string, string>();

  setup({ effect }: ClassCtx) {
    const listener = (event: DeployedEvent) => {
      this.markDeployed(event).catch((error: unknown) => {
        // The deploy stands either way; only its marker is missing.
        console.warn(
          `[activity-versions] could not mark the ${event.target} deploy of ${event.activityId}:`,
          error instanceof Error ? error.message : error,
        );
      });
    };
    this.deployEvents.subscribe(listener);
    effect(() => this.deployEvents.unsubscribe(listener));
  }

  async keepBefore<T>(
    projectId: string,
    activityId: string,
    input: { reason: VersionReason; author: string | null; expectedRevision: string },
    change: () => Promise<T>,
  ): Promise<T> {
    return this.authoring.exclusive(projectId, activityId, async () => {
      const activity = await this.authoring.getActivity(projectId, activityId);
      if (activity.draft.contentRevision !== input.expectedRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "Draft changed. Reload it before applying your edit.",
        );
      // Kept even when a file of the draft is missing or changed, as before a restore. When
      // the change then fails, the version stays: it holds the draft as it still is, so a
      // second try keeps nothing new.
      await this.record(
        projectId,
        activity,
        { kind: "auto", reason: input.reason, author: input.author },
        { lenient: true },
      );
      return change();
    });
  }

  async markDeployed(event: DeployedEvent): Promise<VersionSummary | null> {
    const { projectId, activityId, target } = event;
    if (target !== "qa" && target !== "prod") return null;
    return this.authoring.exclusive(projectId, activityId, async () => {
      const activity = await this.authoring.getActivity(projectId, activityId);
      let row: VersionRow | null;
      if (!event.revision || event.revision === activity.draft.contentRevision) {
        const { version } = await this.record(
          projectId,
          activity,
          { kind: "deploy", author: null },
          { lenient: true },
        );
        row = getVersion(this.db, activityId, version.versionId);
      } else {
        // The draft changed after the deploy took it: mark the newest version holding what went.
        row = await this.versionAtRevision(projectId, activity, event.revision);
      }
      if (!row) return null;
      markVersionDeployed(this.db, activityId, row.versionId, target, event.deployedAt);
      const marked = getVersion(this.db, activityId, row.versionId)!;
      const current = await this.currentManifest(projectId, activity)
        .then(manifestHash)
        .catch(() => null);
      return summarizeVersion(marked, current);
    });
  }

  async status(projectId: string, activityId: string): Promise<VersionStatus> {
    const activity = await this.authoring.getActivity(projectId, activityId);
    const rows = listVersions(this.db, activityId);
    const qa = lastDeployed(rows, "qa");
    const prod = lastDeployed(rows, "prod");
    const current =
      qa || prod
        ? await this.currentManifest(projectId, activity)
            .then(manifestHash)
            .catch(() => null)
        : null;
    const drift = (row: VersionRow | null): DeployDrift =>
      !row ? "never" : current !== null && row.contentHash === current ? "in_sync" : "changed";
    return {
      qa: drift(qa),
      prod: drift(prod),
      qaVersion: qa ? deployedVersion(qa, qa.deployedQaAt!) : null,
      prodVersion: prod ? deployedVersion(prod, prod.deployedProdAt!) : null,
    };
  }

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
    return this.authoring.exclusive(projectId, activityId, async () =>
      this.record(projectId, await this.authoring.getActivity(projectId, activityId), {
        ...input,
        label,
      }),
    );
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

  async diff(
    projectId: string,
    activityId: string,
    versionId: string,
    against: string,
  ): Promise<VersionDiff> {
    const activity = await this.authoring.getActivity(projectId, activityId);
    const { activityDir } = await this.dirs(projectId, activity);
    const before = await this.readManifest(activityDir, this.requireVersion(activityId, versionId));
    const after =
      against === "current"
        ? await this.currentManifest(projectId, activity)
        : await this.readManifest(activityDir, this.requireVersion(activityId, against));
    return versionDiff(before, after);
  }

  async restore(
    projectId: string,
    activityId: string,
    versionId: string,
    expectedRevision: string,
    author: string | null,
  ): Promise<ActivityDraft> {
    return this.authoring.exclusive(projectId, activityId, async () => {
      const activity = await this.authoring.getActivity(projectId, activityId);
      if (activity.draft.contentRevision !== expectedRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "Draft changed. Reload it before restoring a version.",
        );
      const row = this.requireVersion(activityId, versionId);
      const { workspace, activityDir } = await this.dirs(projectId, activity);
      // Every file and the media plan are checked before anything changes.
      const target = await this.readManifest(activityDir, row).catch(() => {
        throw incomplete(null);
      });
      // A version saved under another ref number names that number's media folder; its files
      // go back under this ref's, where the restored manifest binds them.
      const from = target.draft.mediaPlan
        ? refMediaFolder(activity.productCode, target.draft.mediaPlan.manifest.refNum)
        : null;
      const to = refMediaFolder(activity.productCode, activity.refNum);
      const here = (relative: string) =>
        from && relative.startsWith(`${from}/`) ? `${to}${relative.slice(from.length)}` : relative;
      for (const file of target.media) {
        if (!withinRoot(workspace, here(file.path))) throw incomplete(file.path);
        await readBlob(activityDir, file.sha256).catch(() => {
          throw incomplete(file.path);
        });
      }
      if (target.draft.mediaPlan) {
        try {
          // Checked as replaceDraft will write it: under this ref's number and media folder.
          const manifest = structuredClone(target.draft.mediaPlan.manifest);
          readdressMedia(manifest.assets, from!, to);
          validateManifest({ ...manifest, refNum: activity.refNum }, activity);
        } catch (error) {
          throw new HttpError(422, "media_invalid", (error as Error).message);
        }
      }
      const current = await this.currentManifest(projectId, activity).then(manifestHash);
      // The draft already holds this version: there is nothing to restore or to keep.
      if (current === row.contentHash) return activity.draft;
      // Kept even when a file of the draft is missing or changed: that is when an author most
      // needs to go back, and the version holds what was there.
      await this.record(
        projectId,
        activity,
        { kind: "auto", reason: "before_restore", author },
        // The version being restored stays, however old: it is read from next.
        { lenient: true, protect: row.versionId },
      );
      const featuresFile = path.join(
        await this.authoring.draftFilesDir(activity),
        REF_FEATURES_FILE,
      );
      const features = await fs.readFile(featuresFile).catch(() => null);
      let draft: ActivityDraft;
      try {
        // Files the draft has and the version lacks stay: run history may name them.
        for (const file of target.media)
          await this.writeOwned(
            workspace,
            here(file.path),
            await readBlob(activityDir, file.sha256),
          );
        await writeAtomic(
          featuresFile,
          JSON.stringify({ selectedIds: target.implementationFeatures ?? [] }, null, 2) + "\n",
        );
        draft = await this.authoring.replaceDraft(
          projectId,
          activityId,
          target.draft,
          expectedRevision,
          row.draftStatus === "draft" && target.draft.spec !== null,
        );
      } catch (error) {
        // The draft is unchanged, so its features selection goes back to what it was. Media
        // written so far stay; the version kept before the restore holds what they replaced.
        if (features) await writeAtomic(featuresFile, features);
        else await fs.rm(featuresFile, { force: true });
        throw error;
      }
      // Lenient too: the version restored may itself have been kept without a missing file.
      await this.record(
        projectId,
        await this.authoring.getActivity(projectId, activityId),
        { kind: "restore", author, sourceVersionId: row.versionId },
        { lenient: true },
      );
      return draft;
    });
  }

  /**
   * Keep the activity as it is now as a version; the caller holds the activity. `lenient`
   * keeps it even when a file is missing (left out) or changed since it was generated (kept
   * as it is now), for the version kept before a restore. Retention then runs, sparing
   * `protect`.
   */
  private async record(
    projectId: string,
    activity: ActivityDetail,
    input: VersionSaveInput,
    { lenient = false, protect }: { lenient?: boolean; protect?: string } = {},
  ): Promise<VersionSaveResult> {
    const label = input.label ?? null;
    const activityId = activity.id;
    const { workspace, activityDir } = await this.dirs(projectId, activity);
    const files: VersionMedia[] = [];
    // One file at a time: each is read, checked, and stored before the next is opened.
    for (const owned of ownedMediaPaths(activity.draft.mediaPlan?.manifest).owned) {
      const bytes = await this.readOwned(workspace, owned.path).catch((error: unknown) => {
        if (lenient && isMissing(error)) return null;
        throw error;
      });
      if (!bytes) continue;
      const digest = sha256(bytes);
      if (!lenient && owned.expectedSha256 && owned.expectedSha256 !== digest)
        throw new HttpError(
          409,
          "version_media_changed",
          `The file ${owned.path} changed since it was generated.`,
        );
      await writeBlob(activityDir, bytes);
      files.push({ path: owned.path, sha256: digest, bytes: bytes.length });
    }
    const manifest = versionManifest(
      activity.draft,
      await this.readFeatures(await this.authoring.draftFilesDir(activity)),
      files,
    );
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
      moduleRunId: await this.moduleRunId(projectId, activity, input.kind),
      sourceVersionId: input.sourceVersionId ?? null,
      authorUserId: input.author,
      deployedQaAt: null,
      deployedProdAt: null,
      createdAt: new Date().toISOString(),
      draftStatus: activity.draft.status,
    };
    writeVersion(this.db, row);
    await this.prune(activityId, activityDir, protect);
    return { version: summarizeVersion(row, hash), created: true };
  }

  /**
   * The module build recorded with a version; null with none. A deploy version records the
   * newest build, which is what a release ships whatever the preview plays; any other version
   * records the build the preview plays now.
   */
  private async moduleRunId(
    projectId: string,
    activity: ActivityDetail,
    kind: VersionKind,
  ): Promise<string | null> {
    const builds = await this.generation.moduleBuilds(projectId, activity.id).catch(() => []);
    return (
      playingBuild(builds, kind === "deploy" ? null : activity.draft.pinnedModuleRunId)?.runId ??
      null
    );
  }

  /**
   * Remove the automatic versions retention lets go, then every blob no remaining version
   * references. The caller holds the activity. A version whose manifest cannot be read
   * stops the blob sweep, since what it references is then unknown.
   */
  private async prune(activityId: string, activityDir: string, protect?: string): Promise<void> {
    const rows = listVersions(this.db, activityId);
    const doomed = new Set(
      prunableVersions(rows)
        .map((row) => row.versionId)
        .filter((versionId) => versionId !== protect),
    );
    if (doomed.size) deleteVersions(this.db, activityId, [...doomed]);
    const live = new Set<string>();
    for (const row of rows) {
      if (doomed.has(row.versionId)) continue;
      live.add(row.manifestSha);
      let manifest: VersionManifest;
      try {
        manifest = await this.readManifest(activityDir, row);
      } catch {
        return;
      }
      for (const file of manifest.media) live.add(file.sha256);
    }
    const names = await fs.readdir(blobsDir(activityDir)).catch(() => [] as string[]);
    for (const name of names)
      if (isBlobName(name) && !live.has(name))
        await fs.rm(blobFile(activityDir, name), { force: true });
  }

  /**
   * The newest version whose draft content had revision `revision`, read from the versions'
   * manifests; null when none did.
   */
  private async versionAtRevision(
    projectId: string,
    activity: ActivityDetail,
    revision: string,
  ): Promise<VersionRow | null> {
    const { activityDir } = await this.dirs(projectId, activity);
    for (const row of listVersions(this.db, activity.id)) {
      const manifest = await this.readManifest(activityDir, row).catch(() => null);
      if (manifest && draftRevision(manifest.draft) === revision) return row;
    }
    return null;
  }

  private requireVersion(activityId: string, versionId: string): VersionRow {
    const row = getVersion(this.db, activityId, versionId);
    if (!row) throw new HttpError(404, "version_not_found", "Version not found.");
    return row;
  }

  /** The manifest a version was stored as, read from its checked blob. */
  private async readManifest(activityDir: string, row: VersionRow): Promise<VersionManifest> {
    return JSON.parse(
      (await readBlob(activityDir, row.manifestSha)).toString("utf8"),
    ) as VersionManifest;
  }

  /**
   * Put a version's file back at its place in the workspace: beside it first and then renamed
   * over it, so the draft never holds half a file. A file already equal is left alone.
   */
  private async writeOwned(workspace: string, relative: string, bytes: Buffer): Promise<void> {
    const file = withinRoot(workspace, relative);
    if (!file) throw incomplete(relative);
    const stat = await fs.lstat(file).catch(() => null);
    if (stat?.isSymbolicLink()) throw incomplete(relative);
    if (
      stat?.isFile() &&
      stat.size === bytes.length &&
      sha256(await fs.readFile(file)) === sha256(bytes)
    )
      return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, bytes);
  }

  /**
   * The draft as a version manifest, hashing the files without storing them. A file the
   * draft binds and the workspace lacks is left out, so a compare shows it as removed.
   */
  private async currentManifest(
    projectId: string,
    activity: ActivityDetail,
  ): Promise<VersionManifest> {
    const { workspace } = await this.dirs(projectId, activity);
    const files: VersionMedia[] = [];
    for (const owned of ownedMediaPaths(activity.draft.mediaPlan?.manifest).owned) {
      const file = await this.digestOwned(workspace, owned.path).catch((error: unknown) => {
        if (isMissing(error)) return null;
        throw error;
      });
      if (file) files.push(file);
    }
    return versionManifest(
      activity.draft,
      await this.readFeatures(await this.authoring.draftFilesDir(activity)),
      files,
    );
  }

  /**
   * Where a version's parts are: `workspace` is the WAF root, which a version's media paths
   * (`media/loom/...`) are relative to, and `activityDir` is under PENGUIN_HOME, where the
   * activity's version blobs are kept (<collection>/activities/<id>, beside its drafts).
   */
  private async dirs(projectId: string, activity: ActivityDetail) {
    const draftWorkspace = this.authoring.draftWorkspace(
      projectId,
      activity.collectionId,
      activity.id,
      activity.draft.draftId,
    );
    return {
      workspace: await this.wafRoot(),
      activityDir: path.resolve(draftWorkspace, "..", ".."),
    };
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
  private async readFeatures(specDir: string): Promise<string[] | null> {
    const text = await fs.readFile(path.join(specDir, REF_FEATURES_FILE), "utf8").catch(() => null);
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

/**
 * A restore refused because the version lacks a file; names the first one missing as
 * `detail.path` for the App to word, or none when the version's record itself is missing.
 */
function incomplete(file: string | null): HttpError {
  return file === null
    ? new HttpError(
        409,
        "version_incomplete",
        "This version cannot be restored: its record is missing or damaged.",
      )
    : new HttpError(
        409,
        "version_incomplete",
        `This version cannot be restored: its file ${file} is missing or damaged.`,
        undefined,
        { path: file },
      );
}

/** The version that went to `target` last, or null when none went. */
function lastDeployed(rows: readonly VersionRow[], target: "qa" | "prod"): VersionRow | null {
  const at = (row: VersionRow) => (target === "qa" ? row.deployedQaAt : row.deployedProdAt);
  let last: VersionRow | null = null;
  for (const row of rows) {
    const when = at(row);
    if (!when) continue;
    const lastAt = last ? at(last) : null;
    if (!last || !lastAt || when > lastAt || (when === lastAt && row.seq > last.seq)) last = row;
  }
  return last;
}

function deployedVersion(row: VersionRow, deployedAt: string): DeployedVersion {
  return { versionId: row.versionId, seq: row.seq, deployedAt };
}

/** Whether `error` says a file the draft binds is missing from the workspace. */
function isMissing(error: unknown): boolean {
  return error instanceof HttpError && error.code === "version_media_missing";
}

/** Write beside the file and rename over it. */
async function writeAtomic(file: string, data: string | Uint8Array): Promise<void> {
  const temp = `${file}.${newId("tmp")}`;
  try {
    await fs.writeFile(temp, data, { flag: "wx" });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}
