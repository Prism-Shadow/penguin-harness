/**
 * A model's vision flag (image input supported) through PUT/GET.
 *
 * - An explicit false is persisted and read back; omission means supported (no field), for a
 *   catalog model too — the catalog is not consulted (a new Project writes its `false` down).
 * - The visionModel pointer round-trips, survives omission, and goes once its target is
 *   invalid; one naming a model that is absent or has no image support is a 400.
 * - A non-boolean vision is a 400.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { catalogEntryFor } from "@prismshadow/penguin-core";
import type { ModelsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("models vision annotation", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_v");
    owner = apiClient(t.app, a.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_v-vision_${projects}`,
        name: "vision project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  it("vision=false persists and reads back; omitted on a non-catalog model = supported (no field)", async () => {
    // Use a custom id outside the catalog to verify pure TOML semantics (a catalog id
    // falls back to the catalog's own annotation — see the next test case).
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        { provider: "custom", modelId: "blind-model", vision: false },
        { provider: "custom", modelId: "plain-model" },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    const blind = body.models.find((m) => m.provider === "custom" && m.modelId === "blind-model")!;
    const plain = body.models.find((m) => m.provider === "custom" && m.modelId === "plain-model")!;
    expect(blind.vision).toBe(false);
    expect("vision" in plain).toBe(false);

    // PUT again without vision: whole-table replace semantics clear the annotation
    // (back to the default of supported).
    const put2 = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "blind-model" }],
    });
    const body2 = (await put2.json()) as ModelsResponse;
    expect("vision" in body2.models[0]!).toBe(false);
  });

  it("a catalog model without a TOML annotation reads as supported, whatever the catalog says: the file is the only truth", async () => {
    // The catalog marks deepseek-v4-pro as taking no images; a new Project writes that down as
    // `vision = false`, and once the file holds no annotation, nothing restores it.
    expect(catalogEntryFor("deepseek", "deepseek-v4-pro")?.supportsVision).toBe(false);
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro" },
        { provider: "google", modelId: "gemini-3-flash-preview" },
      ],
    });
    const body = (await put.json()) as ModelsResponse;
    for (const row of body.models) expect("vision" in row, row.modelId).toBe(false);
  });

  it("visionModel pointer: round-trips, omission preserves it, removed once the target is invalid", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      visionModel: { provider: "google", modelId: "gemini-3-flash-preview" },
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro", vision: false },
        { provider: "google", modelId: "gemini-3-flash-preview" },
      ],
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as ModelsResponse).visionModel).toEqual({
      provider: "google",
      modelId: "gemini-3-flash-preview",
    });

    // Omitting visionModel: the original value is preserved.
    const put2 = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro", vision: false },
        { provider: "google", modelId: "gemini-3-flash-preview" },
      ],
    });
    expect(((await put2.json()) as ModelsResponse).visionModel).toEqual({
      provider: "google",
      modelId: "gemini-3-flash-preview",
    });

    // The former vision model is now annotated as not supporting images: the
    // annotation takes priority, so the pointer is removed.
    const put3 = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "google", modelId: "gemini-3-flash-preview", vision: false }],
    });
    expect("visionModel" in ((await put3.json()) as ModelsResponse)).toBe(false);
  });

  it("visionModel absent from models or pointing at a model without image support: 400", async () => {
    const missing = await owner.put(`/api/projects/${projectId}/models`, {
      visionModel: { provider: "custom", modelId: "nope" },
      models: [{ provider: "custom", modelId: "m-1" }],
    });
    expect(missing.status).toBe(400);
    const blind = await owner.put(`/api/projects/${projectId}/models`, {
      visionModel: { provider: "custom", modelId: "m-1" },
      models: [{ provider: "custom", modelId: "m-1", vision: false }],
    });
    expect(blind.status).toBe(400);
  });

  it("non-boolean vision returns 400", async () => {
    const bad = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-1", vision: "no" }],
    });
    expect(bad.status).toBe(400);
  });
});
