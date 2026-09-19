import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("native activity authoring API", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });
  it("creates an activity, persists its draft, and rejects stale edits", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "activity_owner");
    const client = apiClient(t.app, owner.cookie);
    const projectResponse = await client.post("/api/projects", {
      projectId: "activity_owner-activity",
      name: "Activity project",
    });
    if (projectResponse.status !== 201)
      throw new Error(`project create: ${projectResponse.status} ${await projectResponse.text()}`);

    const created = await client.post("/api/projects/activity_owner-activity/activities", {
      productCode: "sight-words",
      refNum: 1,
      title: "Sight words",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; draft: { contentRevision: string } };
    expect(body.draft.contentRevision).toHaveLength(64);

    const updated = await client.patch(
      `/api/projects/activity_owner-activity/activities/${body.id}/description`,
      { description: "Practice sight words", expectedRevision: body.draft.contentRevision },
    );
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as { contentRevision: string };
    const applied = await client.post(
      `/api/projects/activity_owner-activity/activities/${body.id}/apply-generated-spec`,
      {
        expectedRevision: updatedBody.contentRevision,
        spec: {
          id: "sight-words",
          moduleFolder: "waf-module-sight-words",
          title: "Sight words",
          runtime: {
            engine: "html",
            layout: "mainOnly",
            theme: "park",
            resolution: "640x480",
            usesAssessment: false,
          },
          activityDescription: "Practice sight words",
          scenes: [{ id: "intro", description: "Choose a word" }],
        },
      },
    );
    expect(applied.status).toBe(200);
    expect(((await applied.json()) as { status: string }).status).toBe("valid");
    const stale = await client.patch(
      `/api/projects/activity_owner-activity/activities/${body.id}/description`,
      { description: "stale edit", expectedRevision: updatedBody.contentRevision },
    );
    expect(stale.status).toBe(409);
  });

  it("lists without creating collections, reuses the default, and isolates project paths", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "author");
    const client = apiClient(t.app, owner.cookie);
    for (const id of ["author-one", "author-two"])
      expect((await client.post("/api/projects", { projectId: id })).status).toBe(201);
    const base = "/api/projects/author-one/activities";
    expect(
      ((await (await client.get(base)).json()) as { activities: unknown[] }).activities,
    ).toEqual([]);
    expect(t.deps.db.prepare("SELECT * FROM activity_collections").all()).toHaveLength(0);
    const created = await client.post(base, { productCode: "p", refNum: 1, title: "One" });
    expect(created.status).toBe(201);
    const one = (await created.json()) as ActivityDetail;
    const two = (await (
      await client.post(base, { productCode: "p", refNum: 2, title: "Two" })
    ).json()) as ActivityDetail;
    expect(two.collectionId).toBe(one.collectionId);
    expect(
      (await client.post(base, { productCode: "p", refNum: 1, title: "Duplicate" })).status,
    ).toBe(409);
    expect(
      ((await (await client.get(base)).json()) as { activities: unknown[] }).activities,
    ).toHaveLength(2);
    expect((await client.get(`/api/projects/author-two/activities/${one.id}`)).status).toBe(404);
    expect(
      (
        await client.post("/api/projects/author-two/activities", {
          collectionId: one.collectionId,
          productCode: "p",
          refNum: 4,
          title: "No",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await client.post(base, {
          collectionId: "../../outside",
          productCode: "p",
          refNum: 4,
          title: "No",
        })
      ).status,
    ).toBe(404);
    const member = await provisionUser(t.app, "reader");
    expect(
      (await client.post("/api/projects/author-one/members", { userId: "reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.get(`${base}/${one.id}`)).status).toBe(200);
    expect(
      (
        await reader.patch(`${base}/${one.id}/description`, {
          description: "No",
          expectedRevision: one.draft.contentRevision,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reader.post(`${base}/${one.id}/generate-spec`, {
          agentId: "default_agent",
          expectedRevision: one.draft.contentRevision,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reader.post(`${base}/${one.id}/plan-media`, {
          expectedRevision: one.draft.contentRevision,
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await reader.put(`${base}/${one.id}/media`, {
          expectedRevision: one.draft.contentRevision,
          manifest: {},
        })
      ).status,
    ).toBe(403);
  });

  it("persists media plans, rejects stale writes and requires replanning after spec changes", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "media_owner");
    const client = apiClient(t.app, owner.cookie);
    expect(
      (await client.post("/api/projects", { projectId: "media_owner-activities" })).status,
    ).toBe(201);
    const base = "/api/projects/media_owner-activities/activities";
    const created = (await (
      await client.post(base, { productCode: "P", refNum: 1, title: "One" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    expect(
      (
        await client.post(`${endpoint}/plan-media`, {
          expectedRevision: created.draft.contentRevision,
        })
      ).status,
    ).toBe(422);
    let draft = (await (
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
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const before = draft.contentRevision;
    draft = (await (
      await client.post(`${endpoint}/plan-media`, { expectedRevision: before })
    ).json()) as ActivityDraft;
    expect(draft.mediaPlan!.manifest.assets["en-US"]).toHaveLength(1);
    expect(draft.contentRevision).not.toBe(before);
    const manifest = structuredClone(draft.mediaPlan!.manifest);
    manifest.assets["en-US"]![0]!.path = "media/images/cat.png";
    expect(
      (await client.put(`${endpoint}/media`, { manifest, expectedRevision: before })).status,
    ).toBe(409);
    const saved = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: draft.contentRevision,
    });
    expect(saved.status).toBe(200);
    draft = (await saved.json()) as ActivityDraft;
    expect(
      ((await (await client.get(endpoint)).json()) as ActivityDetail).draft.mediaPlan!.manifest,
    ).toEqual(manifest);
    const file = path.join(
      projectDir(t.root, "media_owner-activities"),
      "activities",
      created.collectionId,
      "activities",
      created.id,
      "drafts",
      draft.draftId,
      "asset-manifest.json",
    );
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(manifest);
    draft = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: { ...draft.spec, title: "Changed" },
        expectedRevision: draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    expect(
      (await client.put(`${endpoint}/media`, { manifest, expectedRevision: draft.contentRevision }))
        .status,
    ).toBe(409);
    draft = (await (
      await client.post(`${endpoint}/plan-media`, { expectedRevision: draft.contentRevision })
    ).json()) as ActivityDraft;
    expect(draft.mediaPlan!.manifest.assets["en-US"]![0]!.path).toBe("media/images/cat.png");
  });

  it("serializes concurrent edits and reads nested file changes instead of stale DB revisions", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "writer");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "writer-activities" })).status).toBe(
      201,
    );
    const base = "/api/projects/writer-activities/activities";
    const created = (await (
      await client.post(base, { productCode: "p", refNum: 1, title: "One" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const edits = await Promise.all(
      ["a", "b"].map((description) =>
        client.patch(`${endpoint}/description`, {
          description,
          expectedRevision: created.draft.contentRevision,
        }),
      ),
    );
    expect(edits.map((r) => r.status).sort()).toEqual([200, 409]);
    const current = (await (await client.get(endpoint)).json()) as ActivityDetail;
    const draft = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
        spec: activitySpec,
        expectedRevision: current.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const file = path.join(
      projectDir(t.root, "writer-activities"),
      "activities",
      created.collectionId,
      "activities",
      created.id,
      "drafts",
      draft.draftId,
      "draft.json",
    );
    const edited = JSON.parse(await fs.readFile(file, "utf8"));
    edited.spec.scenes[0].description = "Edited outside the index";
    await fs.writeFile(file, JSON.stringify(edited));
    const reread = (await (await client.get(endpoint)).json()) as ActivityDetail;
    expect(reread.draft.contentRevision).not.toBe(draft.contentRevision);
    expect(
      (
        await client.post(`${endpoint}/apply-generated-spec`, {
          spec: activitySpec,
          expectedRevision: draft.contentRevision,
        })
      ).status,
    ).toBe(409);
    const invalid = { ...activitySpec, scenes: [{ id: "bad", description: 12 }] };
    expect(
      (
        await client.post(`${endpoint}/apply-generated-spec`, {
          spec: invalid,
          expectedRevision: reread.draft.contentRevision,
        })
      ).status,
    ).toBe(422);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual(edited);
    await fs.writeFile(file, "{broken");
    expect((await client.get(endpoint)).status).toBe(500);
    expect(await fs.readFile(file, "utf8")).toBe("{broken");
  });

  it("serves bound image previews to the owner only and keeps them private", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "image_owner");
    const ownerClient = apiClient(t.app, owner.cookie);
    const projectId = "image_owner-image_preview_project";
    expect((await ownerClient.post("/api/projects", { projectId })).status).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const created = (await (
      await ownerClient.post(base, { productCode: "sight-words", refNum: 1, title: "Sight words" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const spec = {
      ...activitySpec,
      scenes: [
        {
          id: "intro",
          description: "Look",
          media: { images: [{ key: "cat", description: "A cat" }] },
        },
      ],
    };
    let draft = (await (
      await ownerClient.post(`${endpoint}/apply-generated-spec`, {
        spec,
        expectedRevision: created.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    draft = (await (
      await ownerClient.post(`${endpoint}/plan-media`, { expectedRevision: draft.contentRevision })
    ).json()) as ActivityDraft;
    const manifest = structuredClone(draft.mediaPlan!.manifest);
    manifest.assets["en-US"]![0]!.path = "media/images/cat.png";
    draft = (await (
      await ownerClient.put(`${endpoint}/media`, {
        manifest,
        expectedRevision: draft.contentRevision,
      })
    ).json()) as ActivityDraft;

    const wafRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-api-waf-"));
    cleanups.push(() => fs.rm(wafRoot, { recursive: true, force: true }));
    await fs.mkdir(path.join(wafRoot, "framework", "src"), { recursive: true });
    await fs.writeFile(path.join(wafRoot, "framework", "package.json"), "{}");
    await fs.mkdir(path.join(wafRoot, "modules"));
    await fs.mkdir(path.join(wafRoot, "media", "images"), { recursive: true });
    const png = Buffer.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
    ]);
    await fs.writeFile(path.join(wafRoot, "media/images/cat.png"), png);
    const query = new URLSearchParams({
      language: "en-US",
      assetKey: "cat",
      expectedRevision: draft.contentRevision,
      wafRoot,
    });
    const response = await ownerClient.get(`${endpoint}/media-image?${query}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("image/png");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);

    const staleResponse = await ownerClient.get(
      `${endpoint}/media-image?${new URLSearchParams({
        language: "en-US",
        assetKey: "cat",
        expectedRevision: "stale-revision",
        wafRoot,
      })}`,
    );
    expect(staleResponse.status).toBe(409);

    const member = await provisionUser(t.app, "image_member");
    expect(
      (await ownerClient.post(`/api/projects/${projectId}/members`, { userId: "image_member" }))
        .status,
    ).toBe(201);
    const memberResponse = await apiClient(t.app, member.cookie).get(
      `${endpoint}/media-image?${query}`,
    );
    expect(memberResponse.status).toBe(403);
    const outsider = await provisionUser(t.app, "image_outsider");
    const outsiderResponse = await apiClient(t.app, outsider.cookie).get(
      `${endpoint}/media-image?${query}`,
    );
    expect(outsiderResponse.status).toBe(404);
  });
});
