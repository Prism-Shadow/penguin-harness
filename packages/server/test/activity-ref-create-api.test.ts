/**
 * Making a ref from its product's template: only the canonical ref, marked stable, is one;
 * the new ref gets the template's draft under its own number, a copy of the template's media
 * folder (its accepted media and uploads, not its candidates) with every binding addressed to
 * it, and its features; and a refused or failed create leaves no row and no files.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { activitySpec, refFilesDir, refMediaDir } from "./activity-fixtures.js";
import { fakeMp3Encoding, mp3OfWave, speechWave } from "./audio-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

const PROJECT = "refmaker-work";
const AUDIO_RUN = `run_${"a".repeat(32)}`;
const IMAGE_RUN = `run_${"c".repeat(32)}`;
/** A binding into the template's media folder, as the ref numbered `refNum` holds it. */
const at = (reference: string, refNum: number) =>
  reference.replace("media/loom/words/words-12/", `media/loom/words/words-${refNum}/`);

describe("POST /:activityId/refs", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const t = await createTestApp(fakeMp3Encoding);
    cleanups.push(t.cleanup);
    const owner = await provisionUser(t.app, "refmaker");
    const client = apiClient(t.app, owner.cookie);
    expect((await client.post("/api/projects", { projectId: PROJECT })).status).toBe(201);
    const base = `/api/projects/${PROJECT}/activities`;
    const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
    const create = async (refNum: number) => {
      const response = await client.post(base, {
        productCode: "words",
        refNum,
        title: `words ${refNum}`,
      });
      expect(response.status, await response.clone().text()).toBe(201);
      return (await response.json()) as ActivityDetail;
    };
    const read = async (id: string) =>
      (await (await client.get(`${base}/${id}`)).json()) as ActivityDetail;
    const count = () =>
      (t.deps.db.prepare("SELECT COUNT(*) AS n FROM activities").get() as { n: number }).n;

    // The template: a narration and an image generated and accepted, an image bound to an
    // upload, a spare upload to bind in a new ref, and one implementation feature.
    const template = await create(12);
    const endpoint = `${base}/${template.id}`;
    const specced = (await (
      await client.post(`${endpoint}/apply-generated-spec`, {
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
              audio: { tracks: [{ key: "hello", description: "Greeting", script: "Hello" }] },
            },
          ],
        },
        expectedRevision: template.draft.contentRevision,
      })
    ).json()) as ActivityDraft;
    const planned = await client.post(`${endpoint}/plan-media`, {
      expectedRevision: specced.contentRevision,
    });
    expect(planned.status, await planned.clone().text()).toBe(200);
    const audio = await authoring.storeAudio(PROJECT, template.id, AUDIO_RUN, speechWave());
    let draft = await authoring.applyAudio(
      PROJECT,
      template.id,
      { language: "en-US", assetKey: "hello", script: "Hello", voice: "Kore", model: "m" },
      audio,
      ((await planned.json()) as ActivityDraft).contentRevision,
    );
    const image = await authoring.storeImage(PROJECT, template.id, IMAGE_RUN, imagePng(2, 2));
    draft = await authoring.applyImage(
      PROJECT,
      template.id,
      { language: "en-US", assetKey: "cat", prompt: "A cat", model: "m" },
      image,
      draft.contentRevision,
    );
    const upload = async (name: string) => {
      const response = await client.post(`${endpoint}/media-uploads`, {
        name,
        dataBase64: imagePng(3, 3).toString("base64"),
      });
      expect(response.status).toBe(201);
      return ((await response.json()) as { path: string }).path;
    };
    const dogPath = await upload("dog.png");
    const sparePath = await upload("spare.png");
    const manifest = structuredClone(draft.mediaPlan!.manifest);
    manifest.assets["en-US"]!.find((asset) => asset.key === "dog")!.path = dogPath;
    const bound = await client.put(`${endpoint}/media`, {
      manifest,
      expectedRevision: draft.contentRevision,
    });
    expect(bound.status, await bound.clone().text()).toBe(200);
    const features = (await (await client.get(`${endpoint}/implementation-features`)).json()) as {
      features: { id: string }[];
    };
    const featureId = features.features[0]!.id;
    expect(
      (
        await client.put(`${endpoint}/implementation-features`, {
          selectedIds: [featureId],
        })
      ).status,
    ).toBe(200);
    const markStable = (id: string, stable: boolean) =>
      client.patch(`${base}/${id}/identity`, { stable });
    expect((await markStable(template.id, true)).status).toBe(200);
    const makeRef = (id: string, body: Record<string, unknown>) =>
      client.post(`${base}/${id}/refs`, body);
    const refsDir = (collectionId: string) =>
      path.join(projectDir(t.root, PROJECT), "activities", collectionId, "activities");
    /** Nothing of the ref numbered `refNum` is left: no row, no draft files, no media folder. */
    const gone = async (refNum: number) => {
      const row = t.deps.db
        .prepare("SELECT id FROM activities WHERE product_code = 'words' AND ref_num = ?")
        .get(refNum);
      expect(row).toBeUndefined();
      await expect(fs.stat(path.dirname(refFilesDir(t.root, "words", refNum)))).rejects.toThrow();
      await expect(fs.stat(refMediaDir(t.root, "words", refNum))).rejects.toThrow();
      const dirs = await fs.readdir(refsDir(template.collectionId)).catch((): string[] => []);
      expect(dirs.every((id) => id === template.id)).toBe(true);
    };
    return {
      t,
      client,
      base,
      create,
      read,
      count,
      template: await read(template.id),
      dogPath,
      sparePath,
      featureId,
      markStable,
      makeRef,
      gone,
    };
  }

  it("suggests the next number and says whether the ref is the template", async () => {
    const { client, base, template, create } = await setup();
    const other = await create(30);
    const answer = await (await client.get(`${base}/${template.id}/refs/next-number`)).json();
    expect(answer).toEqual({ refNum: 31, canonical: true, taken: [12, 30] });
    const fromOther = await (await client.get(`${base}/${other.id}/refs/next-number`)).json();
    expect(fromOther).toMatchObject({ refNum: 31, canonical: false });
  });

  it("refuses a template that is not canonical, or not stable, and creates nothing", async () => {
    const { base, template, create, count, markStable, makeRef } = await setup();
    const other = await create(13);
    await markStable(other.id, true);
    const before = count();
    const notCanonical = await makeRef(other.id, { refNum: 20, decisions: [] });
    expect(notCanonical.status).toBe(409);
    expect(((await notCanonical.json()) as { error: { code: string } }).error.code).toBe(
      "not_canonical",
    );
    await markStable(template.id, false);
    const notStable = await makeRef(template.id, { refNum: 20, decisions: [] });
    expect(notStable.status).toBe(409);
    const body = (await notStable.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("template_not_stable");
    expect(body.error.message).toContain("Ref 12");
    expect(count()).toBe(before);
    expect(base).toBeTruthy();
  });

  it("keeps every asset: the same draft under the new number, with its media folder copied", async () => {
    const { t, client, base, template, read, makeRef, dogPath, featureId } = await setup();
    // A take the template never accepted stays behind.
    const candidates = path.join(refMediaDir(t.root, "words", 12), "candidates");
    await fs.mkdir(candidates, { recursive: true });
    await fs.writeFile(path.join(candidates, `run_${"f".repeat(32)}.png`), imagePng(1, 1));
    const response = await makeRef(template.id, {
      refNum: 20,
      displayName: "Winter",
      decisions: [{ language: "en-US", assetKey: "cat", action: "keep" }],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const made = (await response.json()) as ActivityDetail;
    expect(made.id).not.toBe(template.id);
    expect(made.refNum).toBe(20);
    expect(made.displayName).toBe("Winter");
    expect(made.stable).toBe(false);
    expect(made.productId).toBe(template.productId);
    expect(made.title).toBe(template.title);
    expect(made.draft.status).toBe("valid");
    expect(made.draft.description).toBe(template.draft.description);
    expect(made.draft.spec).toEqual(template.draft.spec);
    // Every binding into the template's media folder is addressed to the new ref's.
    const expected = structuredClone(template.draft.mediaPlan!.manifest);
    for (const asset of Object.values(expected.assets).flat())
      if (asset.path) asset.path = at(asset.path, 20);
    expect(made.draft.mediaPlan!.manifest).toEqual({ ...expected, refNum: 20 });
    const hello = made.draft.mediaPlan!.manifest.assets["en-US"]!.find((a) => a.key === "hello")!;
    expect(hello.path).toBe("media/loom/words/words-20/audios/english/hello.mp3");
    // The media folder was copied, without the template's candidates.
    const media = refMediaDir(t.root, "words", 20);
    expect(await fs.readFile(path.join(media, "images", "english", "cat.png"))).toEqual(
      imagePng(2, 2),
    );
    await expect(fs.stat(path.join(media, "candidates"))).rejects.toThrow();
    const endpoint = `${base}/${made.id}`;
    // Generated audio plays from the new ref though its run belongs to the template.
    const clip = await client.get(`${endpoint}/runs/${AUDIO_RUN}/audio`);
    expect(clip.status, await clip.clone().text()).toBe(200);
    expect(Buffer.from(await clip.arrayBuffer())).toEqual(mp3OfWave(speechWave()));
    const picture = await client.get(
      `${endpoint}/media-image?${new URLSearchParams({
        language: "en-US",
        assetKey: "cat",
        expectedRevision: made.draft.contentRevision,
      })}`,
    );
    expect(picture.status, await picture.clone().text()).toBe(200);
    const uploaded = await client.get(
      `${endpoint}/media-upload?${new URLSearchParams({ path: at(dogPath, 20) })}`,
    );
    expect(uploaded.status).toBe(200);
    const features = (await (await client.get(`${endpoint}/implementation-features`)).json()) as {
      selectedIds: string[];
    };
    expect(features.selectedIds).toEqual([featureId]);
    // The template is as it was.
    const after = await read(template.id);
    expect(after.draft.contentRevision).toBe(template.draft.contentRevision);
    expect(after.refNum).toBe(12);
  });

  it("clears and binds what the decisions say", async () => {
    const { t, template, makeRef, sparePath } = await setup();
    const response = await makeRef(template.id, {
      refNum: 21,
      decisions: [
        { language: "en-US", assetKey: "hello", action: "clear", script: "Hi", voice: "Puck" },
        { language: "en-US", assetKey: "cat", action: "bind", path: sparePath },
        { language: "en-US", assetKey: "dog", action: "clear", description: "A wolf" },
      ],
    });
    expect(response.status, await response.clone().text()).toBe(201);
    const made = (await response.json()) as ActivityDetail;
    const assets = made.draft.mediaPlan!.manifest.assets["en-US"]!;
    const hello = assets.find((asset) => asset.key === "hello")!;
    expect(hello).toMatchObject({ script: "Hi", voice: "Puck" });
    expect(hello.path).toBeUndefined();
    expect(hello.generatedAudio).toBeUndefined();
    const cat = assets.find((asset) => asset.key === "cat")!;
    // The template's upload, as the new ref's copy of it.
    expect(sparePath.startsWith("media/loom/words/words-12/uploads/")).toBe(true);
    expect(cat.path).toBe(at(sparePath, 21));
    expect(await fs.readFile(path.join(t.root, "waf-checkout", cat.path!))).toEqual(imagePng(3, 3));
    expect(cat.generatedImage).toBeUndefined();
    const dog = assets.find((asset) => asset.key === "dog")!;
    expect(dog).toMatchObject({ description: "A wolf" });
    expect(dog.path).toBeUndefined();
  });

  it("refuses a number the product holds", async () => {
    const { template, makeRef, count } = await setup();
    const before = count();
    const response = await makeRef(template.id, { refNum: 12, decisions: [] });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "activity_exists",
    );
    expect(count()).toBe(before);
  });

  it("refuses a number whose media folder is already in the media repository", async () => {
    const { t, template, makeRef, count } = await setup();
    const before = count();
    const stray = refMediaDir(t.root, "words", 25);
    await fs.mkdir(stray, { recursive: true });
    await fs.writeFile(path.join(stray, "kept.txt"), "someone's");
    const response = await makeRef(template.id, { refNum: 25, decisions: [] });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "activity_exists",
    );
    expect(count()).toBe(before);
    // What was there is left alone.
    expect(await fs.readFile(path.join(stray, "kept.txt"), "utf8")).toBe("someone's");
  });

  it("refuses a plan naming what the template lacks, before any ref exists", async () => {
    const { template, makeRef, count } = await setup();
    const before = count();
    const response = await makeRef(template.id, {
      refNum: 22,
      decisions: [{ language: "en-US", assetKey: "owl", action: "clear" }],
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "ref_plan_invalid",
    );
    expect(count()).toBe(before);
    const malformed = await makeRef(template.id, { refNum: 22, decisions: "all" });
    expect(malformed.status).toBe(400);
  });

  it("removes the new ref again when binding an upload the template lacks", async () => {
    const { template, makeRef, count, gone } = await setup();
    const before = count();
    const response = await makeRef(template.id, {
      refNum: 23,
      decisions: [
        {
          language: "en-US",
          assetKey: "cat",
          action: "bind",
          path: "media/loom/words/words-12/uploads/none-1.png",
        },
      ],
    });
    expect(response.status).toBe(422);
    expect(count()).toBe(before);
    await gone(23);
  });

  it("leaves no row and no directory when copying fails", async () => {
    const { template, makeRef, count, gone } = await setup();
    const before = count();
    vi.spyOn(fs, "cp").mockRejectedValueOnce(new Error("disk full"));
    const response = await makeRef(template.id, { refNum: 24, decisions: [] });
    expect(response.status).toBe(500);
    expect(count()).toBe(before);
    await gone(24);
    // The number is free again.
    const retry = await makeRef(template.id, { refNum: 24, decisions: [] });
    expect(retry.status, await retry.clone().text()).toBe(201);
  });
});
