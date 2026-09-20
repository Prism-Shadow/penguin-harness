import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import { activitySpec } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

function bookSpec() {
  return {
    ...activitySpec,
    scenes: [
      {
        id: "scene-1-cover",
        role: "cover",
        description: "Cover",
        media: { images: [{ key: "cover", description: "A friendly blue penguin" }] },
      },
      {
        id: "scene-2-title",
        role: "title",
        description: "Title",
        media: { images: [{ key: "title", description: "A book title card" }] },
      },
      {
        id: "scene-3-story",
        role: "story",
        description: "Story",
        media: { images: [{ key: "story", description: "A penguin walking home" }] },
        audio: {
          tracks: [
            {
              key: "narration-story-1",
              description: "Narration",
              script: "The penguin walks home.",
            },
          ],
        },
      },
    ],
  };
}

describe("book activity authoring contract", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup(activityType: "book" | "standard" = "book") {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "bookauthor");
    const client = apiClient(t.app, owner.cookie);
    const projectId = "bookauthor-activities";
    const project = await client.post("/api/projects", { projectId });
    expect(project.status, await project.clone().text()).toBe(201);
    const base = `/api/projects/${projectId}/activities`;
    const created = (await (
      await client.post(base, {
        productCode: "penguin-book",
        refNum: 1,
        title: "Penguin book",
        activityType,
      })
    ).json()) as ActivityDetail;
    return { client, base, endpoint: `${base}/${created.id}`, created };
  }

  it("persists a valid book and leaves an existing saved book unchanged on invalid replacement", async () => {
    const { client, endpoint, created } = await setup();
    const applied = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: bookSpec(),
      expectedRevision: created.draft.contentRevision,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    const saved = (await applied.json()) as ActivityDraft;
    expect(saved.status).toBe("valid");
    expect(saved.spec).toEqual(bookSpec());

    const invalid = {
      ...activitySpec,
      scenes: [{ id: "story", role: "story", description: "Read the story" }],
    };
    const rejected = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: invalid,
      expectedRevision: saved.contentRevision,
    });
    expect(rejected.status).toBe(422);
    const reread = (await (await client.get(endpoint)).json()) as ActivityDetail;
    expect(reread.draft.contentRevision).toBe(saved.contentRevision);
    expect(reread.draft.spec).toEqual(saved.spec);
  });

  it("retains generic standard activities without book media requirements", async () => {
    const { client, endpoint, created } = await setup("standard");
    const applied = await client.post(`${endpoint}/apply-generated-spec`, {
      spec: {
        ...activitySpec,
        scenes: [{ id: "intro", description: "A generic activity scene" }],
      },
      expectedRevision: created.draft.contentRevision,
    });
    expect(applied.status, await applied.clone().text()).toBe(200);
    expect(((await applied.json()) as ActivityDraft).status).toBe("valid");
  });

  it("requires ordered cover/title/story pages, one image each, visible narration words, and unique audio keys", async () => {
    const { client, endpoint, created } = await setup();
    const invalidCases = [
      {
        label: "multiple images",
        edit: (spec: ReturnType<typeof bookSpec>) => {
          spec.scenes[0]!.media.images.push({ key: "extra", description: "Extra" });
        },
      },
      {
        label: "story before title",
        edit: (spec: ReturnType<typeof bookSpec>) => {
          [spec.scenes[1], spec.scenes[2]] = [spec.scenes[2]!, spec.scenes[1]!];
        },
      },
      {
        label: "invisible narration",
        edit: (spec: ReturnType<typeof bookSpec>) => {
          spec.scenes[2]!.audio!.tracks[0]!.script = "...";
        },
      },
      {
        label: "duplicate audio key",
        edit: (spec: ReturnType<typeof bookSpec>) => {
          spec.scenes[2]!.audio!.tracks.push({
            key: "narration-story-1",
            description: "Second narration",
            script: "More words.",
          });
        },
      },
    ];
    for (const { label, edit } of invalidCases) {
      const invalid = bookSpec();
      edit(invalid);
      const response = await client.post(`${endpoint}/apply-generated-spec`, {
        spec: invalid,
        expectedRevision: created.draft.contentRevision,
      });
      expect(response.status, label).toBe(422);
    }
  });
});
