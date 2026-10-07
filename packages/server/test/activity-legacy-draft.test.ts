/**
 * Drafts saved before activities were stored in their modules: the first read writes the
 * old `draft.json` into the ref's module files, leaves the old file where it was, and never
 * overwrites files already at the ref's address in the module.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail } from "../src/activities/domain.js";
import { activitySpec, refFilesDir, refMediaDir } from "./activity-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { writeRefDraft } from "../src/activities/ref-files.js";
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

  it.each([
    ["on the first read", false],
    ["for a draft that moved before its media did", true],
  ])(
    "moves its accepted takes, uploads and waiting takes into the media repository %s",
    async (_when, movedAlready) => {
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
      const specced = (await (
        await client.post(`${endpoint}/apply-generated-spec`, {
          expectedRevision: created.draft.contentRevision,
          spec: {
            ...activitySpec,
            scenes: [
              {
                id: "intro",
                description: "Look",
                media: {
                  images: [
                    { key: "cat", description: "A cat" },
                    { key: "dog", description: "A dog" },
                  ],
                },
              },
            ],
          },
        })
      ).json()) as ActivityDetail["draft"];
      const planned = await client.post(`${endpoint}/plan-media`, {
        expectedRevision: specced.contentRevision,
      });
      expect(planned.status, await planned.clone().text()).toBe(200);
      const saved = (await (await client.get(endpoint)).json()) as ActivityDetail;

      // The same draft as an earlier Penguin kept it: the cat an accepted take bound under
      // media/generated, the dog an upload under media/uploads, and a take still waiting.
      const cat = imagePng(2, 2);
      const catRun = `run_${"a".repeat(32)}`;
      const waiting = `run_${"b".repeat(32)}`;
      const draft = structuredClone(saved.draft);
      const assets = draft.mediaPlan!.manifest.assets["en-US"]!;
      const catAsset = assets.find((asset) => asset.key === "cat")!;
      catAsset.path = `media/generated/${catRun}.png`;
      catAsset.generatedImage = {
        runId: catRun,
        sha256: createHash("sha256").update(cat).digest("hex"),
      };
      assets.find((asset) => asset.key === "dog")!.path = "media/uploads/dog-1.png";
      const workspace = path.join(
        projectDir(t.root, PROJECT),
        "activities",
        saved.collectionId,
        "activities",
        saved.id,
        "drafts",
        saved.draft.draftId,
      );
      await fs.mkdir(path.join(workspace, "images"), { recursive: true });
      await fs.mkdir(path.join(workspace, "media", "uploads"), { recursive: true });
      await fs.writeFile(path.join(workspace, "images", `${catRun}.png`), cat);
      await fs.writeFile(path.join(workspace, "images", `${waiting}.png`), imagePng(3, 3));
      await fs.writeFile(path.join(workspace, "media", "uploads", "dog-1.png"), imagePng(4, 4));
      await fs.writeFile(path.join(workspace, "draft.json"), JSON.stringify(draft));
      await fs.rm(refMediaDir(t.root, "words", 1), { recursive: true, force: true });
      // Either nothing is in the module yet, or the draft is, still binding the old paths.
      if (movedAlready) await writeRefDraft(refFilesDir(t.root, "words", 1), draft);
      else await fs.rm(path.dirname(refFilesDir(t.root, "words", 1)), { recursive: true });

      const read = await client.get(endpoint);
      expect(read.status, await read.clone().text()).toBe(200);
      const moved = (await read.json()) as ActivityDetail;
      expect(moved.draft.status).toBe(saved.draft.status);
      const bound = moved.draft.mediaPlan!.manifest.assets["en-US"]!;
      const media = refMediaDir(t.root, "words", 1);
      expect(bound.find((asset) => asset.key === "cat")!.path).toBe(
        "media/loom/words/words-1/images/english/cat.png",
      );
      expect(await fs.readFile(path.join(media, "images", "english", "cat.png"))).toEqual(cat);
      expect(bound.find((asset) => asset.key === "dog")!.path).toBe(
        "media/loom/words/words-1/uploads/dog-1.png",
      );
      expect(await fs.readFile(path.join(media, "uploads", "dog-1.png"))).toEqual(imagePng(4, 4));
      expect(await fs.readFile(path.join(media, "candidates", `${waiting}.png`))).toEqual(
        imagePng(3, 3),
      );
      // The old files stay where they were.
      await fs.access(path.join(workspace, "images", `${catRun}.png`));
    },
  );

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
