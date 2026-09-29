/**
 * Drafts saved before activities were stored in their modules: the first read writes the
 * old `draft.json` into the ref's module files, leaves the old file where it was, and never
 * overwrites files already at the ref's address in the module.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail } from "../src/activities/domain.js";
import { activitySpec, refFilesDir } from "./activity-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const PROJECT = "legacy_owner-work";

describe("drafts saved before activities moved into modules", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  /** A ref with a saved spec and selected features, turned back into the old layout. */
  async function legacyRef() {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "legacy_owner");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const created = (await (
      await client.post(base, { productCode: "words", refNum: 1, title: "Words" })
    ).json()) as ActivityDetail;
    const endpoint = `${base}/${created.id}`;
    const applied = await client.post(`${endpoint}/apply-generated-spec`, {
      expectedRevision: created.draft.contentRevision,
      spec: activitySpec,
    });
    expect(applied.status).toBe(200);
    const saved = (await (await client.get(endpoint)).json()) as ActivityDetail;
    // What an earlier Penguin kept: the whole draft in draft.json under PENGUIN_HOME.
    const workspace = path.join(
      projectDir(t.root, PROJECT),
      "activities",
      saved.collectionId,
      "activities",
      saved.id,
      "drafts",
      saved.draft.draftId,
    );
    await fs.mkdir(workspace, { recursive: true });
    await fs.writeFile(path.join(workspace, "draft.json"), JSON.stringify(saved.draft));
    await fs.writeFile(
      path.join(workspace, "implementation-features.json"),
      JSON.stringify({ selectedIds: ["r2phcs03l-freight-conveyor"] }),
    );
    const refFolder = path.dirname(refFilesDir(t.root, "words", 1));
    await fs.rm(refFolder, { recursive: true });
    return { t, client, endpoint, saved, workspace, refFolder };
  }

  it("moves the draft into the module on its first read, and keeps the old file", async () => {
    const { t, client, endpoint, saved, workspace } = await legacyRef();
    const read = await client.get(endpoint);
    expect(read.status, await read.clone().text()).toBe(200);
    const moved = (await read.json()) as ActivityDetail;
    expect(moved.draft).toMatchObject({
      draftId: saved.draft.draftId,
      contentRevision: saved.draft.contentRevision,
      status: saved.draft.status,
      spec: saved.draft.spec,
    });
    const files = refFilesDir(t.root, "words", 1);
    expect(JSON.parse(await fs.readFile(path.join(files, "activity_spec.json"), "utf8"))).toEqual(
      saved.draft.spec,
    );
    expect(
      JSON.parse(await fs.readFile(path.join(files, "implementation_features.json"), "utf8")),
    ).toEqual({ selectedIds: ["r2phcs03l-freight-conveyor"] });
    await fs.access(path.join(workspace, "draft.json"));
    // Read again, it comes from the module.
    await fs.rm(path.join(workspace, "draft.json"));
    expect((await client.get(endpoint)).status).toBe(200);
  });

  it("never overwrites files already at the ref's address in the module", async () => {
    const { client, endpoint, refFolder } = await legacyRef();
    // A Loom-authored ref at the same address: its spec, but no penguin.json.
    await fs.mkdir(path.join(refFolder, "spec"), { recursive: true });
    await fs.writeFile(path.join(refFolder, "spec", "activity_spec.json"), '{"loom":true}');
    const read = await client.get(endpoint);
    expect(read.status).toBe(409);
    expect(await read.json()).toMatchObject({ error: { code: "ref_files_conflict" } });
    expect(await fs.readFile(path.join(refFolder, "spec", "activity_spec.json"), "utf8")).toBe(
      '{"loom":true}',
    );
  });
});
