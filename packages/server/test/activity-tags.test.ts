/**
 * Product tags: the normalization rules, and the route that stores them for every ref of a
 * product at once.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { ActivityDetail, ActivityRecord } from "../src/activities/domain.js";
import { TAGS_MAX, TAG_MAX, normalizeTags } from "../src/activities/tags.js";
import { HttpError } from "../src/http/errors.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof HttpError ? `${error.status} ${error.code}` : String(error);
  }
  return undefined;
}

describe("normalizeTags", () => {
  it("trims, collapses inner whitespace, drops empties, and dedupes ignoring case", () => {
    expect(normalizeTags([" Phonics ", "phonics", "Grade 1"])).toEqual(["Phonics", "Grade 1"]);
    expect(normalizeTags(["  grade \t  1 ", "", "   ", "GRADE 1", "pilot"])).toEqual([
      "grade 1",
      "pilot",
    ]);
    expect(normalizeTags([])).toEqual([]);
  });

  it("keeps the first spelling and the order the author gave", () => {
    expect(normalizeTags(["b", "A", "a", "B", "c"])).toEqual(["b", "A", "c"]);
  });

  it("refuses anything that is not a list of strings", () => {
    for (const bad of [undefined, null, "phonics", 3, { tag: "x" }, ["ok", 3], [null]])
      expect(code(() => normalizeTags(bad))).toBe("400 tags_invalid");
  });

  it("refuses control characters and over-long tags", () => {
    expect(code(() => normalizeTags(["a\u0000b"]))).toBe("400 tags_invalid");
    expect(code(() => normalizeTags(["bell\u0007"]))).toBe("400 tags_invalid");
    // Line breaks and tabs are whitespace, and collapse like any other.
    expect(normalizeTags(["line\nbreak", "tab\there"])).toEqual(["line break", "tab here"]);
    expect(normalizeTags(["x".repeat(TAG_MAX)])).toEqual(["x".repeat(TAG_MAX)]);
    expect(code(() => normalizeTags(["x".repeat(TAG_MAX + 1)]))).toBe("400 tags_too_long");
    // Length is judged after trimming, so padding alone never makes a tag too long.
    expect(normalizeTags([`  ${"x".repeat(TAG_MAX)}  `])).toEqual(["x".repeat(TAG_MAX)]);
  });

  it("allows at most TAGS_MAX distinct tags, counting after dedupe", () => {
    const many = Array.from({ length: TAGS_MAX }, (_, index) => `t${index}`);
    expect(normalizeTags([...many, ...many.map((tag) => tag.toUpperCase())])).toHaveLength(
      TAGS_MAX,
    );
    expect(code(() => normalizeTags([...many, "one more"]))).toBe("400 tags_too_many");
  });
});

describe("PUT /:activityId/tags", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "tagger");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "tagger-tags" })).status).toBe(201);
    const base = "/api/projects/tagger-tags/activities";
    const create = async (productCode: string, refNum: number) =>
      (await (
        await client.post(base, { productCode, refNum, title: `${productCode} ${refNum}` })
      ).json()) as ActivityDetail;
    return { t, client, base, create };
  }

  it("stores normalized tags on the product, so every ref of it lists them", async () => {
    const { client, base, create } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const other = await create("letters", 1);
    expect(one.tags).toEqual([]);

    const response = await client.put(`${base}/${two.id}/tags`, {
      tags: [" Phonics ", "phonics", "Grade 1"],
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tags: ["Phonics", "Grade 1"] });

    const { activities } = (await (await client.get(base)).json()) as {
      activities: ActivityRecord[];
    };
    const byId = new Map(activities.map((activity) => [activity.id, activity.tags]));
    expect(byId.get(one.id)).toEqual(["Phonics", "Grade 1"]);
    expect(byId.get(two.id)).toEqual(["Phonics", "Grade 1"]);
    expect(byId.get(other.id)).toEqual([]);
    expect(((await (await client.get(`${base}/${one.id}`)).json()) as ActivityDetail).tags).toEqual(
      ["Phonics", "Grade 1"],
    );
    // A ref made later joins the product and its tags.
    expect((await create("words", 3)).tags).toEqual(["Phonics", "Grade 1"]);

    // Replacing, not merging; an empty list clears them.
    await client.put(`${base}/${one.id}/tags`, { tags: ["pilot", "Phonics"] });
    expect(((await (await client.get(`${base}/${two.id}`)).json()) as ActivityDetail).tags).toEqual(
      ["pilot", "Phonics"],
    );
    expect(await (await client.put(`${base}/${one.id}/tags`, { tags: [] })).json()).toEqual({
      tags: [],
    });
  });

  it("refuses invalid tags and unknown activities, and leaves the stored tags alone", async () => {
    const { client, base, create } = await setup();
    const one = await create("words", 1);
    await client.put(`${base}/${one.id}/tags`, { tags: ["keep"] });
    const bad = await client.put(`${base}/${one.id}/tags`, { tags: ["x".repeat(TAG_MAX + 1)] });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: "tags_too_long" } });
    expect((await client.put(`${base}/${one.id}/tags`, {})).status).toBe(400);
    expect((await client.put(`${base}/act_missing/tags`, { tags: ["a"] })).status).toBe(404);
    expect(((await (await client.get(`${base}/${one.id}`)).json()) as ActivityDetail).tags).toEqual(
      ["keep"],
    );
  });

  it("refuses a ref with no product", async () => {
    const { t, client, base, create } = await setup();
    const one = await create("words", 1);
    t.deps.db.prepare("UPDATE activities SET product_id = NULL WHERE id = ?").run(one.id);
    const response = await client.put(`${base}/${one.id}/tags`, { tags: ["a"] });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "no_product" } });
  });

  it("lets a member read tags but not change them", async () => {
    const { t, client, base, create } = await setup();
    const one = await create("words", 1);
    await client.put(`${base}/${one.id}/tags`, { tags: ["phonics"] });
    const member = await provisionUser(t.app, "tag_reader");
    expect(
      (await client.post("/api/projects/tagger-tags/members", { userId: "tag_reader" })).status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    const { activities } = (await (await reader.get(base)).json()) as {
      activities: ActivityRecord[];
    };
    expect(activities[0]!.tags).toEqual(["phonics"]);
    expect((await reader.put(`${base}/${one.id}/tags`, { tags: ["mine"] })).status).toBe(403);
  });
});
