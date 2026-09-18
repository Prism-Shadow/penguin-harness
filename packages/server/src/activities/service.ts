import fs from "node:fs/promises";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { projectDir } from "@prismshadow/penguin-core";
import type { Config, Db } from "../hmr/capabilities.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import {
  contentRevision,
  newCollectionManifest,
  newId,
  normalizeProductCode,
  normalizeRefNum,
  type ActivityDraft,
  type ActivityRecord,
  type CollectionManifest,
  validateActivitySpec,
} from "./domain.js";

const COLLECTION_DIR = "activities";

@Component()
export class ActivityService implements ActivityAuthoring {
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;

  private collectionDir(projectId: string, collectionId: string): string {
    return path.join(projectDir(this.config.root, projectId), COLLECTION_DIR, collectionId);
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
    const existing = collectionId
      ? (this.db
          .prepare(
            "SELECT collection_id FROM activity_collections WHERE project_id = ? AND collection_id = ?",
          )
          .get(projectId, collectionId) as Record<string, unknown> | undefined)
      : undefined;
    const id = (existing?.collection_id as string | undefined) ?? collectionId ?? newId("col");
    const dir = this.collectionDir(projectId, id);
    await fs.mkdir(dir, { recursive: true });
    const manifestPath = path.join(dir, "collection.json");
    try {
      return JSON.parse(await fs.readFile(manifestPath, "utf8")) as CollectionManifest;
    } catch {
      const manifest = newCollectionManifest();
      manifest.collectionId = id;
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      this.db
        .prepare(
          "INSERT OR IGNORE INTO activity_collections (project_id, collection_id, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(projectId, id, dir, manifest.createdAt, manifest.updatedAt);
      return manifest;
    }
  }

  async createActivity(
    projectId: string,
    input: {
      collectionId?: string;
      productCode: unknown;
      refNum: unknown;
      title: string;
      activityType?: "standard" | "book";
    },
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    const productCode = normalizeProductCode(input.productCode);
    const refNum = normalizeRefNum(input.refNum);
    const title = input.title.trim();
    if (!title) throw new Error("title is required.");
    const collection = await this.ensureCollection(projectId, input.collectionId);
    const duplicate = this.db
      .prepare(
        "SELECT id FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ? AND archived = 0",
      )
      .get(collection.collectionId, productCode, refNum);
    if (duplicate) throw new Error("An activity with this productCode/refNum already exists.");
    const now = new Date().toISOString();
    const activity: ActivityRecord = {
      id: newId("act"),
      collectionId: collection.collectionId,
      productCode,
      refNum,
      title,
      activityType: input.activityType ?? "standard",
      createdAt: now,
      updatedAt: now,
      archived: false,
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
    this.db
      .prepare(
        "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
      )
      .run(
        activity.id,
        activity.collectionId,
        activity.productCode,
        activity.refNum,
        activity.title,
        activity.activityType,
        now,
        now,
      );
    this.db
      .prepare(
        "INSERT INTO activity_drafts (draft_id, activity_id, base_version_id, content_revision, status, updated_at) VALUES (?, ?, NULL, ?, ?, ?)",
      )
      .run(draft.draftId, draft.activityId, draft.contentRevision, draft.status, now);
    await this.writeDraft(projectId, draft, collection.collectionId);
    return { ...activity, draft };
  }

  async listActivities(projectId: string, collectionId: string): Promise<ActivityRecord[]> {
    await this.ensureCollection(projectId, collectionId);
    return (
      this.db
        .prepare(
          "SELECT * FROM activities WHERE collection_id = ? AND archived = 0 ORDER BY product_code, ref_num",
        )
        .all(collectionId) as Record<string, unknown>[]
    ).map((row) => this.mapActivity(row));
  }

  async getActivity(
    projectId: string,
    activityId: string,
  ): Promise<ActivityRecord & { draft: ActivityDraft }> {
    const row = this.db
      .prepare("SELECT * FROM activities WHERE id = ? AND archived = 0")
      .get(activityId) as Record<string, unknown> | undefined;
    if (!row) throw new Error("Activity not found.");
    const activity = this.mapActivity(row);
    const draftRow = this.db
      .prepare(
        "SELECT * FROM activity_drafts WHERE activity_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(activityId) as Record<string, unknown> | undefined;
    if (!draftRow) throw new Error("Activity draft not found.");
    const draft = await this.readDraft(
      projectId,
      activity.collectionId,
      activity.id,
      draftRow.draft_id as string,
      draftRow,
    );
    return { ...activity, draft };
  }

  async updateDescription(
    projectId: string,
    activityId: string,
    description: string,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    const current = await this.getActivity(projectId, activityId);
    if (expectedRevision !== undefined && expectedRevision !== current.draft.contentRevision)
      throw new Error("Draft changed since it was loaded.");
    const draft = {
      ...current.draft,
      description,
      contentRevision: contentRevision({ description, spec: current.draft.spec }),
      updatedAt: new Date().toISOString(),
    };
    await this.writeDraft(projectId, draft, current.collectionId);
    this.db
      .prepare(
        "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
      )
      .run(draft.contentRevision, draft.status, draft.updatedAt, draft.draftId);
    this.db
      .prepare("UPDATE activities SET updated_at = ? WHERE id = ?")
      .run(draft.updatedAt, activityId);
    return draft;
  }

  async applySpec(
    projectId: string,
    activityId: string,
    spec: unknown,
    expectedRevision?: string,
  ): Promise<ActivityDraft> {
    const current = await this.getActivity(projectId, activityId);
    if (expectedRevision !== undefined && expectedRevision !== current.draft.contentRevision)
      throw new Error("Draft changed since generation started.");
    const parsed = validateActivitySpec(spec);
    const draft = {
      ...current.draft,
      spec: parsed,
      status: "valid" as const,
      contentRevision: contentRevision({ description: current.draft.description, spec: parsed }),
      updatedAt: new Date().toISOString(),
    };
    await this.writeDraft(projectId, draft, current.collectionId);
    this.db
      .prepare(
        "UPDATE activity_drafts SET content_revision = ?, status = ?, updated_at = ? WHERE draft_id = ?",
      )
      .run(draft.contentRevision, draft.status, draft.updatedAt, draft.draftId);
    this.db
      .prepare("UPDATE activities SET title = ?, updated_at = ? WHERE id = ?")
      .run(
        typeof parsed.title === "string" ? parsed.title : current.title,
        draft.updatedAt,
        activityId,
      );
    return draft;
  }

  private async writeDraft(
    projectId: string,
    draft: ActivityDraft,
    collectionId: string,
  ): Promise<void> {
    const dir = this.draftWorkspace(projectId, collectionId, draft.activityId, draft.draftId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "draft.json"), `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    if (draft.spec !== null)
      await fs.writeFile(
        path.join(dir, "activity-spec.json"),
        `${JSON.stringify(draft.spec, null, 2)}\n`,
        "utf8",
      );
    await fs.writeFile(path.join(dir, "description.md"), draft.description, "utf8");
  }

  private async readDraft(
    projectId: string,
    collectionId: string,
    activityId: string,
    draftId: string,
    row: Record<string, unknown>,
  ): Promise<ActivityDraft> {
    const dir = this.draftWorkspace(projectId, collectionId, activityId, draftId);
    let file: Partial<ActivityDraft> = {};
    try {
      file = JSON.parse(
        await fs.readFile(path.join(dir, "draft.json"), "utf8"),
      ) as Partial<ActivityDraft>;
    } catch {
      /* rebuild from index */
    }
    return {
      draftId,
      activityId,
      baseVersionId: (row.base_version_id as string | null) ?? null,
      contentRevision: (row.content_revision as string) ?? file.contentRevision ?? "",
      status: (row.status as ActivityDraft["status"]) ?? file.status ?? "draft",
      description: typeof file.description === "string" ? file.description : "",
      spec: file.spec && typeof file.spec === "object" ? file.spec : null,
      updatedAt: (row.updated_at as string) ?? file.updatedAt ?? "",
    };
  }

  private mapActivity(row: Record<string, unknown>): ActivityRecord {
    return {
      id: row.id as string,
      collectionId: row.collection_id as string,
      productCode: row.product_code as string,
      refNum: row.ref_num as number,
      title: row.title as string,
      activityType: row.activity_type as ActivityRecord["activityType"],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      archived: Boolean(row.archived),
    };
  }
}
