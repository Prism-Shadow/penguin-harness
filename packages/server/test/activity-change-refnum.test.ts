/**
 * Changing a ref's number: everything keyed by the activity id stays, the product's canonical
 * number follows the ref that owns the module, the media manifest names the new address, and
 * the refusals (stable, taken, stale, checkout) leave nothing changed.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { activitySpec, refFilesDir } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("POST /:activityId/ref-number", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "renumberer");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "renumberer-work" })).status).toBe(201);
    const base = "/api/projects/renumberer-work/activities";
    const create = async (productCode: string, refNum: number) => {
      const response = await client.post(base, {
        productCode,
        refNum,
        title: `${productCode} ${refNum}`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const read = async (id: string) =>
      (await (await client.get(`${base}/${id}`)).json()) as ActivityDetail;
    const renumber = (id: string, refNum: unknown, expectedRevision: string) =>
      client.post(`${base}/${id}/ref-number`, { refNum, expectedRevision });
    const numbers = (id: string) =>
      t.deps.db
        .prepare(
          `SELECT a.ref_num AS refNum, p.canonical_ref_num AS canonical FROM activities a
           JOIN activity_products p ON p.product_id = a.product_id WHERE a.id = ?`,
        )
        .get(id) as { refNum: number; canonical: number | null };
    const authoring = () =>
      t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    return { t, client, base, create, read, renumber, numbers, authoring };
  }

  /** A draft with a media plan, so the manifest carries the ref's address. */
  async function withMedia(
    client: ReturnType<typeof apiClient>,
    endpoint: string,
    revision: string,
  ): Promise<ActivityDraft> {
    const specced = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: {
          ...activitySpec,
          scenes: [
            {
              id: "intro",
              description: "Look",
              media: { images: [{ key: "cat", description: "A cat" }] },
            },
          ],
        },
        expectedRevision: revision,
      })
    ).json()) as ActivityDraft;
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: specced.contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    return (await planned.json()) as ActivityDraft;
  }

  it("renumbers a ref, keeps its uploads, runs and draft, and frees the old number", async () => {
    const { t, client, base, create, read, renumber } = await setup();
    const one = await create("words", 12);
    const endpoint = `${base}/${one.id}`;
    const draft = await withMedia(client, endpoint, one.draft.contentRevision);
    expect(draft.mediaPlan!.manifest.refNum).toBe(12);
    const uploaded = await client.post(`${endpoint}/media-uploads`, {
      name: "bell.wav",
      dataBase64: Buffer.concat([
        Buffer.from("RIFF", "ascii"),
        Buffer.alloc(4),
        Buffer.from("WAVE", "ascii"),
        Buffer.alloc(16),
      ]).toString("base64"),
    });
    expect(uploaded.status).toBe(201);
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run_done', 'renumberer-work', ?, 'succeeded', 'now', 'spec', ?)",
      )
      .run(one.id, JSON.stringify({ runId: "run_done", status: "succeeded" }));

    const response = await renumber(one.id, 13, draft.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    const changed = (await response.json()) as ActivityDetail;
    expect(changed.refNum).toBe(13);
    expect(changed.draft.mediaPlan!.manifest.refNum).toBe(13);
    expect(changed.draft.contentRevision).not.toBe(draft.contentRevision);

    const fetched = await read(one.id);
    expect(fetched.refNum).toBe(13);
    expect(fetched.draft.draftId).toBe(one.draft.draftId);
    expect(fetched.draft.mediaPlan!.manifest.refNum).toBe(13);
    expect(fetched.draft.contentRevision).toBe(changed.draft.contentRevision);
    expect(fetched.draft.spec).toEqual(draft.spec);
    const media = (await (await client.get(`${endpoint}/media-uploads`)).json()) as {
      media: unknown[];
    };
    expect(media.media).toHaveLength(1);
    const runs = (await (await client.get(`${endpoint}/runs`)).json()) as {
      runs: { runId: string }[];
    };
    expect(runs.runs.map((run) => run.runId)).toEqual(["run_done"]);

    // The number it left is free for another ref of the product.
    await create("words", 12);
  });

  it("reads the ref under its new number while its files still name the old one", async () => {
    const { t, client, base, create, read, renumber } = await setup();
    const one = await create("words", 12);
    const draft = await withMedia(client, `${base}/${one.id}`, one.draft.contentRevision);
    const names = ["asset_manifest.json", "penguin.json"];
    const before = await Promise.all(
      names.map((name) => fs.readFile(path.join(refFilesDir(t.root, "words", 12), name), "utf8")),
    );
    const response = await renumber(one.id, 13, draft.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    const changed = (await response.json()) as ActivityDetail;
    // The folder moved, and nothing was rewritten yet: the state between the index commit
    // and the draft write, or after a crash there.
    for (const [index, name] of names.entries())
      await fs.writeFile(path.join(refFilesDir(t.root, "words", 13), name), before[index]!, "utf8");

    const fetched = await read(one.id);
    expect(fetched.refNum).toBe(13);
    expect(fetched.draft.mediaPlan!.manifest.refNum).toBe(13);
    expect(fetched.draft.contentRevision).toBe(changed.draft.contentRevision);
    expect(fetched.draft.status).toBe(draft.status);
  });

  it("moves the product's canonical number with the ref that owns the module", async () => {
    const { create, read, renumber, numbers, authoring } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const response = await renumber(one.id, 5, one.draft.contentRevision);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(numbers(one.id)).toEqual({ refNum: 5, canonical: 5 });
    expect(authoring().isCanonicalRef(await read(one.id))).toBe(true);
    expect(authoring().isCanonicalRef(await read(two.id))).toBe(false);

    // A sibling's renumber leaves the canonical number alone.
    expect((await renumber(two.id, 7, two.draft.contentRevision)).status).toBe(200);
    expect(numbers(two.id)).toEqual({ refNum: 7, canonical: 5 });
  });

  it("refuses a stable ref, a taken number, a stale draft, the same or an invalid number", async () => {
    const { client, base, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    await create("words", 2);
    const revision = one.draft.contentRevision;

    expect((await client.patch(`${base}/${one.id}/identity`, { stable: true })).status).toBe(200);
    const stable = await renumber(one.id, 3, revision);
    expect(stable.status).toBe(409);
    expect(await stable.json()).toMatchObject({ error: { code: "ref_stable" } });
    expect((await client.patch(`${base}/${one.id}/identity`, { stable: false })).status).toBe(200);

    const taken = await renumber(one.id, 2, revision);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toMatchObject({ error: { code: "activity_exists" } });

    const stale = await renumber(one.id, 3, "stale-revision");
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: { code: "draft_conflict" } });

    const same = await renumber(one.id, 1, revision);
    expect(same.status).toBe(400);
    expect(await same.json()).toMatchObject({ error: { code: "ref_unchanged" } });

    for (const invalid of [-1, 1.5, "3", null]) {
      const refused = await renumber(one.id, invalid, revision);
      expect(refused.status).toBe(400);
    }
    expect(numbers(one.id)).toEqual({ refNum: 1, canonical: 1 });
  });

  it("refuses a number an archived ref keeps", async () => {
    const { client, base, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    expect((await client.delete(`${base}/${two.id}`)).status).toBe(204);
    const refused = await renumber(one.id, 2, one.draft.contentRevision);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "activity_exists" } });
    expect(numbers(one.id).refNum).toBe(1);
  });

  it("refuses while a run is working on the ref", async () => {
    const { t, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run_x', 'renumberer-work', ?, 'running', 'now', 'spec', '{}')",
      )
      .run(one.id);
    const refused = await renumber(one.id, 4, one.draft.contentRevision);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "run_active" } });
    expect(numbers(one.id).refNum).toBe(1);
  });

  it("restores the numbers when the draft cannot be written", async () => {
    const { t, client, base, create, read, renumber, numbers } = await setup();
    const one = await create("words", 3);
    const draft = await withMedia(client, `${base}/${one.id}`, one.draft.contentRevision);
    const files = refFilesDir(t.root, "words", 3);
    // A directory where the description file goes makes the draft write fail part way.
    const description = path.join(files, "activity_description.txt");
    const text = await fs.readFile(description, "utf8");
    await fs.rm(description);
    await fs.mkdir(description);

    const failed = await renumber(one.id, 9, draft.contentRevision);
    expect(failed.status).toBe(500);
    expect(numbers(one.id)).toEqual({ refNum: 3, canonical: 3 });
    const revision = t.deps.db
      .prepare("SELECT content_revision AS r FROM activity_drafts WHERE draft_id = ?")
      .get(one.draft.draftId) as { r: string };
    expect(revision.r).toBe(draft.contentRevision);

    await fs.rm(description, { recursive: true });
    await fs.writeFile(description, text, "utf8");
    const fetched = await read(one.id);
    expect(fetched.refNum).toBe(3);
    expect(fetched.draft.mediaPlan!.manifest.refNum).toBe(3);
    expect(fetched.draft.contentRevision).toBe(draft.contentRevision);
    const exported = JSON.parse(
      await fs.readFile(path.join(files, "asset_manifest.json"), "utf8"),
    ) as { refNum: number };
    expect(exported.refNum).toBe(3);
  });

  it("moves the ref's folder, configuration and assessment in its module with the number", async () => {
    const { t, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    const module = path.join(t.root, "waf-checkout", "modules", "waf-module-words");
    await fs.mkdir(path.join(module, "configurations"), { recursive: true });
    await fs.mkdir(path.join(module, "assessments"), { recursive: true });
    await fs.writeFile(path.join(module, "configurations", "words-1.json"), "{}");
    await fs.writeFile(path.join(module, "assessments", "words-1.json"), '{"items":[]}');

    const moved = await renumber(one.id, 2, one.draft.contentRevision);
    expect(moved.status, await moved.clone().text()).toBe(200);
    expect(numbers(one.id).refNum).toBe(2);
    await fs.access(path.join(refFilesDir(t.root, "words", 2), "penguin.json"));
    await expect(fs.access(refFilesDir(t.root, "words", 1))).rejects.toThrow();
    expect(await fs.readFile(path.join(module, "assessments", "words-2.json"), "utf8")).toBe(
      '{"items":[]}',
    );
    await fs.access(path.join(module, "configurations", "words-2.json"));
    await expect(fs.access(path.join(module, "configurations", "words-1.json"))).rejects.toThrow();
  });

  it("refuses a number whose files are already in the module, and moves nothing", async () => {
    const { t, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    const module = path.join(t.root, "waf-checkout", "modules", "waf-module-words");
    await fs.mkdir(path.join(module, "assessments"), { recursive: true });
    await fs.writeFile(path.join(module, "assessments", "words-7.json"), "{}");

    const refused = await renumber(one.id, 7, one.draft.contentRevision);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "activity_exists" } });
    expect(numbers(one.id).refNum).toBe(1);
    await fs.access(path.join(refFilesDir(t.root, "words", 1), "penguin.json"));
  });

  it("is for owners only", async () => {
    const { t, client, create, renumber, numbers } = await setup();
    const one = await create("words", 1);
    const member = await provisionUser(t.app, "renumber_reader");
    expect(
      (await client.post("/api/projects/renumberer-work/members", { userId: "renumber_reader" }))
        .status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    const refused = await reader.post(
      `/api/projects/renumberer-work/activities/${one.id}/ref-number`,
      { refNum: 2, expectedRevision: one.draft.contentRevision },
    );
    expect(refused.status).toBe(403);
    expect(numbers(one.id).refNum).toBe(1);
  });
});
