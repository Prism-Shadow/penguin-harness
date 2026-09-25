/**
 * An activity with versions to compare and restore: an app with one owner, an activity, and
 * helpers to read the draft, save a version, and give the draft generated, uploaded and
 * checkout media.
 */
import path from "node:path";
import { expect } from "vitest";
import { projectDir } from "@prismshadow/penguin-core";
import type { ActivityDetail, ActivityDraft } from "../src/activities/domain.js";
import type { VersionSaveResult, VersionSummary } from "../src/activities/version-types.js";
import type { ActivityAuthoring } from "../src/mechanisms/activities.js";
import { activitySpec } from "./activity-fixtures.js";
import { speechWave } from "./audio-fixtures.js";
import { imagePng } from "./image-fixtures.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

export const AUDIO_RUN = `run_${"a".repeat(32)}`;
export const IMAGE_RUN = `run_${"c".repeat(32)}`;

export async function versionsApp(project: string, cleanups: (() => Promise<void>)[]) {
  const t = await createTestApp();
  cleanups.push(t.cleanup);
  const owner = await provisionUser(t.app, "versions");
  const client = apiClient(t.app, owner.cookie);
  expect((await client.post("/api/projects", { projectId: project })).status).toBe(201);
  const base = `/api/projects/${project}/activities`;
  const created = await client.post(base, { productCode: "words", refNum: 1, title: "Words" });
  expect(created.status).toBe(201);
  const activity = (await created.json()) as ActivityDetail;
  const endpoint = `${base}/${activity.id}`;
  const authoring = t.deps.tree.api<ActivityAuthoring>("ActivitiesModule", "ActivityAuthoring");
  const read = async () => (await (await client.get(endpoint)).json()) as ActivityDetail;
  const saved = async (body: Record<string, unknown> = {}) =>
    ((await (await client.post(`${endpoint}/versions`, body)).json()) as VersionSaveResult).version;
  const list = async () =>
    ((await (await client.get(`${endpoint}/versions`)).json()) as { versions: VersionSummary[] })
      .versions;
  const describe = async (text: string) => {
    const response = await client.patch(`${endpoint}/description`, {
      description: text,
      expectedRevision: (await read()).draft.contentRevision,
    });
    expect(response.status).toBe(200);
    return (await response.json()) as ActivityDraft;
  };
  const activityDir = path.join(
    projectDir(t.root, project),
    "activities",
    activity.collectionId,
    "activities",
    activity.id,
  );
  const workspace = path.join(activityDir, "drafts", activity.draft.draftId);
  return {
    t,
    client,
    endpoint,
    activity,
    authoring,
    project,
    read,
    saved,
    list,
    describe,
    activityDir,
    workspace,
  };
}

export type VersionsApp = Awaited<ReturnType<typeof versionsApp>>;

/** A narration and an image generated and accepted, one image bound to an upload, one to the checkout. */
export async function withMedia(s: VersionsApp) {
  const { client, endpoint, activity, authoring, project } = s;
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
                { key: "tree", description: "A tree" },
              ],
            },
            audio: { tracks: [{ key: "hello", description: "Greeting", script: "Hello" }] },
          },
        ],
      },
      expectedRevision: (await s.read()).draft.contentRevision,
    })
  ).json()) as ActivityDraft;
  const planned = await client.post(`${endpoint}/plan-media`, {
    expectedRevision: specced.contentRevision,
  });
  expect(planned.status, await planned.clone().text()).toBe(200);
  const wave = speechWave();
  let draft = await authoring.applyAudio(
    project,
    activity.id,
    { language: "en-US", assetKey: "hello", script: "Hello", voice: "Kore", model: "m" },
    await authoring.storeAudio(project, activity.id, AUDIO_RUN, wave),
    ((await planned.json()) as ActivityDraft).contentRevision,
  );
  const png = imagePng(2, 2);
  draft = await authoring.applyImage(
    project,
    activity.id,
    { language: "en-US", assetKey: "cat", prompt: "A cat", model: "m" },
    await authoring.storeImage(project, activity.id, IMAGE_RUN, png),
    draft.contentRevision,
  );
  const uploadBytes = imagePng(3, 3);
  const uploaded = await client.post(`${endpoint}/media-uploads`, {
    name: "dog.png",
    dataBase64: uploadBytes.toString("base64"),
  });
  expect(uploaded.status).toBe(201);
  const dogPath = ((await uploaded.json()) as { path: string }).path;
  const manifest = structuredClone(draft.mediaPlan!.manifest);
  const assets = manifest.assets["en-US"]!;
  assets.find((asset) => asset.key === "dog")!.path = dogPath;
  assets.find((asset) => asset.key === "tree")!.path = "media/loom/intro/tree.png";
  const bound = await client.put(`${endpoint}/media`, {
    manifest,
    expectedRevision: draft.contentRevision,
  });
  expect(bound.status, await bound.clone().text()).toBe(200);
  return { wave, png, uploadBytes, dogPath };
}

/** The narration generated again, under a new run, with different audio. */
export async function regenerateNarration(s: VersionsApp, runId: string, samples = 96) {
  const wave = speechWave(samples);
  const draft = await s.authoring.applyAudio(
    s.project,
    s.activity.id,
    { language: "en-US", assetKey: "hello", script: "Hello", voice: "Kore", model: "m" },
    await s.authoring.storeAudio(s.project, s.activity.id, runId, wave),
    (await s.read()).draft.contentRevision,
  );
  return { wave, draft };
}
