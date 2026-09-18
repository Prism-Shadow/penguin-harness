import { describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("native activity authoring API", () => {
  it("creates an activity, persists its draft, and rejects stale edits", async () => {
    const t = await createTestApp();
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
          runtime: { engine: "html" },
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
});
