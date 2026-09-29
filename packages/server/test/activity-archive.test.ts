/**
 * Deleting an activity archives it: it leaves every list, its files stay, and the rules that
 * keep the product level coherent (a canonical ref outlives its siblings, a running run is
 * never orphaned, a number is never reused) still hold.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail } from "../src/activities/domain.js";
import { refFilesDir } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("DELETE /:activityId", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "archiver");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: "archiver-work" })).status).toBe(201);
    const base = "/api/projects/archiver-work/activities";
    const create = async (productCode: string, refNum: number) => {
      const response = await client.post(base, {
        productCode,
        refNum,
        title: `${productCode} ${refNum}`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const listed = async () =>
      ((await (await client.get(base)).json()) as { activities: { id: string }[] }).activities.map(
        (activity) => activity.id,
      );
    const canonical = (productCode: string) =>
      (
        t.deps.db
          .prepare("SELECT canonical_ref_num AS n FROM activity_products WHERE product_code = ?")
          .get(productCode) as { n: number | null }
      ).n;
    return { t, client, base, create, listed, canonical };
  }

  it("removes the activity from the list and from reads, and keeps its draft on disk", async () => {
    const { t, client, base, create, listed } = await setup();
    const one = await create("words", 1);
    const draftDir = refFilesDir(t.root, "words", 1);
    await fs.access(path.join(draftDir, "penguin.json"));

    const response = await client.delete(`${base}/${one.id}`);
    expect(response.status).toBe(204);
    expect(await listed()).toEqual([]);
    expect((await client.get(`${base}/${one.id}`)).status).toBe(404);
    expect((await client.delete(`${base}/${one.id}`)).status).toBe(404);
    // Archived, not removed: the row and every file stay.
    expect(t.deps.db.prepare("SELECT archived FROM activities WHERE id = ?").get(one.id)).toEqual({
      archived: 1,
    });
    await fs.access(path.join(draftDir, "penguin.json"));
    await fs.access(path.join(draftDir, "activity_description.txt"));
  });

  it("refuses the canonical ref while other refs are live, and allows it once they are gone", async () => {
    const { client, base, create, listed } = await setup();
    const one = await create("words", 1);
    const two = await create("words", 2);
    const refused = await client.delete(`${base}/${one.id}`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "canonical_has_refs" } });
    expect(await listed()).toEqual([one.id, two.id]);

    expect((await client.delete(`${base}/${two.id}`)).status).toBe(204);
    expect((await client.delete(`${base}/${one.id}`)).status).toBe(204);
    expect(await listed()).toEqual([]);
  });

  it("refuses while a run is working on the activity", async () => {
    const { t, client, base, create } = await setup();
    const one = await create("words", 1);
    t.deps.db
      .prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES ('run_x', 'archiver-work', ?, 'running', 'now', 'spec', '{}')",
      )
      .run(one.id);
    const refused = await client.delete(`${base}/${one.id}`);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: { code: "run_active" } });
    t.deps.db.prepare("UPDATE activity_runs SET status = 'succeeded'").run();
    expect((await client.delete(`${base}/${one.id}`)).status).toBe(204);
  });

  it("refuses to reuse an archived ref's number, and leaves the module with it", async () => {
    const { client, base, create, canonical } = await setup();
    const one = await create("words", 1);
    await client.put(`${base}/${one.id}/tags`, { tags: ["phonics"] });
    expect((await client.delete(`${base}/${one.id}`)).status).toBe(204);

    const again = await client.post(base, { productCode: "words", refNum: 1, title: "Again" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: "activity_archived" } });
    // A live duplicate is still the ordinary conflict.
    const three = await create("words", 3);
    const duplicate = await client.post(base, { productCode: "words", refNum: 3, title: "Dup" });
    expect(await duplicate.json()).toMatchObject({ error: { code: "activity_exists" } });

    // The canonical number stays with the deleted ref: moving the module is the author's
    // decision, not a side effect of creating a ref. The product keeps its tags.
    expect(canonical("words")).toBe(1);
    expect(three.tags).toEqual(["phonics"]);
  });

  it("keeps the canonical ref when a sibling is created after another sibling is deleted", async () => {
    const { client, base, create, canonical } = await setup();
    await create("words", 1);
    const two = await create("words", 2);
    expect((await client.delete(`${base}/${two.id}`)).status).toBe(204);
    await create("words", 4);
    expect(canonical("words")).toBe(1);
  });

  it("is for owners only", async () => {
    const { t, client, base, create, listed } = await setup();
    const one = await create("words", 1);
    const member = await provisionUser(t.app, "archive_reader");
    expect(
      (await client.post("/api/projects/archiver-work/members", { userId: "archive_reader" }))
        .status,
    ).toBe(201);
    const reader = apiClient(t.app, member.cookie);
    expect((await reader.delete(`${base}/${one.id}`)).status).toBe(403);
    expect(await listed()).toEqual([one.id]);
  });

  it("does not reach another project's activity", async () => {
    const { client, create } = await setup();
    const one = await create("words", 1);
    expect((await client.post("/api/projects", { projectId: "archiver-other" })).status).toBe(201);
    expect((await client.delete(`/api/projects/archiver-other/activities/${one.id}`)).status).toBe(
      404,
    );
  });
});
