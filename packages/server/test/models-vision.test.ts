/**
 * Round-trip of a model's vision flag (whether image input is supported) through
 * PUT/GET: explicit false is persisted and read back; omission means supported
 * (the response carries no field); a non-boolean value returns 400.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("models vision 标注", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_v");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_v-vision", name: "vision 项目" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("vision=false 落盘回读；目录外模型省略 = 支持（不携带字段）", async () => {
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

  it("目录内模型无 TOML 标注时 vision 回落内置目录标注", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        { provider: "deepseek", modelId: "deepseek-v4-pro" },
        { provider: "google", modelId: "gemini-3-flash-preview" },
      ],
    });
    const body = (await put.json()) as ModelsResponse;
    expect(
      body.models.find((m) => m.provider === "deepseek" && m.modelId === "deepseek-v4-pro")!.vision,
    ).toBe(false);
    expect(
      body.models.find((m) => m.provider === "google" && m.modelId === "gemini-3-flash-preview")!
        .vision,
    ).toBe(true);
  });

  it("visionModel 指针：往返、省略保留、目标失效即移除", async () => {
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

  it("visionModel 不在 models 内或指向不支持图片的模型：400", async () => {
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

  it("vision 非布尔值 400", async () => {
    const bad = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-1", vision: "no" }],
    });
    expect(bad.status).toBe(400);
  });
});
