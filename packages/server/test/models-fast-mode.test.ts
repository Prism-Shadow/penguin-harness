/**
 * Round-trip of a model's fast_mode annotation (premium faster serving tier) through
 * PUT/GET: only `true` is persisted and read back; false or omission clears it (absent =
 * off — existing configs are untouched by the feature); a non-boolean value returns 400.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ModelsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("models fast-mode annotation", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_f");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_f-fast", name: "fast project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("fastMode=true persists and reads back; false or omitted = off (no field)", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        { provider: "custom", modelId: "fast-model", fastMode: true },
        // Explicit false is accepted but never persisted: absent = off is the contract.
        { provider: "custom", modelId: "slow-model", fastMode: false },
        { provider: "custom", modelId: "plain-model" },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    const byId = (id: string) =>
      body.models.find((m) => m.provider === "custom" && m.modelId === id)!;
    expect(byId("fast-model").fastMode).toBe(true);
    expect("fastMode" in byId("slow-model")).toBe(false);
    expect("fastMode" in byId("plain-model")).toBe(false);

    // A fresh GET reads the same annotation back from disk.
    const get = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(
      get.models.find((m) => m.provider === "custom" && m.modelId === "fast-model")!.fastMode,
    ).toBe(true);

    // PUT again without fastMode: whole-table replace semantics clear the annotation
    // (back to the default of off).
    const put2 = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "fast-model" }],
    });
    const body2 = (await put2.json()) as ModelsResponse;
    expect("fastMode" in body2.models[0]!).toBe(false);
  });

  it("a preset model takes the annotation too (user-owned; the catalog never presets it)", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "deepseek", modelId: "deepseek-v4-pro", fastMode: true }],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    expect(body.models[0]!.fastMode).toBe(true);
  });

  it("non-boolean fastMode returns 400", async () => {
    const bad = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-1", fastMode: "yes" }],
    });
    expect(bad.status).toBe(400);
  });
});
