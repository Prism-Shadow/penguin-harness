/**
 * A model's prompt_cache_1h annotation (the one-hour prompt cache lifetime) through PUT/GET.
 *
 * - Only `true` is persisted and read back; false or omission clears it (absent means the
 *   provider's default lifetime, so existing configs are untouched).
 * - A preset model takes the annotation too (it is the user's; the catalog never presets it).
 * - A non-boolean value is a 400.
 * - The connectivity test follows the draft value like fast mode, falling back to the stored
 *   annotation, so an unsaved toggle is what gets tested.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ModelsResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("models one-hour prompt-cache annotation", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_pc1h");
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
        projectId: `owner_pc1h-${projects}`,
        name: "hour cache project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  it("promptCache1h=true persists and reads back; false or omitted = the default lifetime", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [
        {
          provider: "custom",
          modelId: "hour-cache",
          clientType: "anthropic-official",
          promptCache1h: true,
        },
        // Explicit false is accepted but never persisted: absent = the provider's default.
        { provider: "custom", modelId: "default-cache", promptCache1h: false },
        { provider: "custom", modelId: "plain-cache" },
      ],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    const byId = (id: string) =>
      body.models.find((m) => m.provider === "custom" && m.modelId === id)!;
    expect(byId("hour-cache").promptCache1h).toBe(true);
    expect("promptCache1h" in byId("default-cache")).toBe(false);
    expect("promptCache1h" in byId("plain-cache")).toBe(false);

    // A fresh GET reads the same annotation back from disk.
    const get = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(
      get.models.find((m) => m.provider === "custom" && m.modelId === "hour-cache")!.promptCache1h,
    ).toBe(true);

    // PUT again without promptCache1h: whole-table replace semantics clear the annotation
    // (back to the provider's default lifetime).
    const put2 = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "hour-cache" }],
    });
    const body2 = (await put2.json()) as ModelsResponse;
    expect("promptCache1h" in body2.models[0]!).toBe(false);
  });

  it("a preset model takes the annotation too (user-owned; the catalog never presets it)", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", promptCache1h: true }],
    });
    expect(put.status).toBe(200);
    const body = (await put.json()) as ModelsResponse;
    expect(body.models[0]!.promptCache1h).toBe(true);
  });

  it("non-boolean promptCache1h returns 400", async () => {
    const bad = await owner.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-1", promptCache1h: "yes" }],
    });
    expect(bad.status).toBe(400);
  });
});
