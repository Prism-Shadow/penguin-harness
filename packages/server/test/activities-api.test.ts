import fs from "node:fs/promises";
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
});
