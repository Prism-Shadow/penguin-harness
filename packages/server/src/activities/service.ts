import fs from "node:fs/promises";
import path from "node:path";
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import { projectDir } from "@prismshadow/penguin-core";
import type { Config, Db } from "../hmr/capabilities.js";
import type { ActivityAuthoring } from "../mechanisms/activities.js";
import { HttpError } from "../http/errors.js";
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
  @Use() private readonly config!: Config;
  @Use() private readonly db!: Db;
  private readonly locks = new ActivityLocks();

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
    const collection = await this.ensureCollection(projectId, input.collectionId);
    return this.locks.run(`create:${collection.collectionId}`, async () => {
      if (
        this.db
          .prepare(
            "SELECT id FROM activities WHERE collection_id = ? AND product_code = ? AND ref_num = ?",
          )
          .get(collection.collectionId, productCode, refNum)
      )
        throw new HttpError(409, "activity_exists", "This productCode/refNum is already reserved.");
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
      await this.writeDraft(projectId, draft, collection.collectionId);
      this.db.exec("BEGIN");
      try {
        this.db
          .prepare(
            "INSERT INTO activities (id, collection_id, product_code, ref_num, title, activity_type, created_at, updated_at, archived) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
          )
          .run(
            activity.id,
            activity.collectionId,
            productCode,
            refNum,
            title,
            activity.activityType,
            now,
            now,
          );
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
  }

  async listActivities(projectId: string, collectionId?: string): Promise<ActivityRecord[]> {
    return (
      this.db
        .prepare(
          `SELECT a.* FROM activities a
      JOIN activity_collections c ON c.collection_id = a.collection_id
      WHERE c.project_id = ? AND a.archived = 0 AND (? IS NULL OR a.collection_id = ?)
      ORDER BY a.product_code, a.ref_num, a.id`,
        )
        .all(projectId, collectionId ?? null, collectionId ?? null) as Record<string, unknown>[]
    ).map((row) => this.mapActivity(row));
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
    const activity = this.mapActivity(row);
    const draftRow = this.db
      .prepare(
        "SELECT draft_id FROM activity_drafts WHERE activity_id = ? ORDER BY updated_at DESC, draft_id LIMIT 1",
      )
      .get(activityId) as { draft_id: string } | undefined;
    if (!draftRow) throw new Error("Activity draft index is missing.");
    const file = JSON.parse(
      await fs.readFile(
        path.join(
          this.draftWorkspace(projectId, activity.collectionId, activityId, draftRow.draft_id),
          "draft.json",
        ),
        "utf8",
      ),
    ) as ActivityDraft;
    if (
      file.draftId !== draftRow.draft_id ||
      file.activityId !== activityId ||
      typeof file.description !== "string" ||
      (file.spec !== null && (typeof file.spec !== "object" || Array.isArray(file.spec)))
    )
      throw new Error("Activity draft is corrupt.");
    // The file is authoritative. Never substitute the index for missing/corrupt content.
    const revision = contentRevision({ description: file.description, spec: file.spec });
    return {
      ...activity,
      draft: {
        ...file,
        contentRevision: revision,
        status: revision === file.contentRevision ? file.status : "draft",
      },
    };
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
    return this.change(projectId, activityId, expectedRevision, (draft) => ({
      ...draft,
      spec: parsed,
      status: "valid",
    }));
  }
  private async change(
    projectId: string,
    activityId: string,
    expectedRevision: string | undefined,
    edit: (draft: ActivityDraft) => ActivityDraft,
  ): Promise<ActivityDraft> {
    return this.locks.run(activityId, async () => {
      const current = await this.getActivity(projectId, activityId);
      if (!expectedRevision || expectedRevision !== current.draft.contentRevision)
        throw new HttpError(
          409,
          "draft_conflict",
          "Draft changed. Reload it before applying your edit.",
        );
      const draft = edit(current.draft);
      draft.contentRevision = contentRevision({ description: draft.description, spec: draft.spec });
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
    await fs.writeFile(path.join(dir, "description.md"), draft.description, "utf8");
    await atomicJson(path.join(dir, "draft.json"), draft);
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
