import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import type { ProjectCreateResponse } from "../src/api/types.js";

describe("models key health and reset HTTP routes", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-keys_test", name: "Keys Test" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("GET /api/projects/:projectId/models/keys/health returns key health report", async () => {
    // Configure a model with multiple API keys
    const putRes = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "deepseek", modelId: "deepseek-chat" },
      models: [
        {
          provider: "deepseek",
          modelId: "deepseek-chat",
          apiKey: "sk-proj-key-alpha, sk-proj-key-beta",
        },
      ],
    });
    expect(putRes.status).toBe(200);

    const getRes = await api.get(
      `/api/projects/${projectId}/models/keys/health?provider=deepseek&modelId=deepseek-chat`,
    );
    expect(getRes.status).toBe(200);
    const report = await getRes.json();
    expect(report.totalKeys).toBe(2);
    expect(report.healthyCount).toBe(2);
    expect(report.keys).toHaveLength(2);
    expect(report.keys[0].status).toBe("healthy");
    expect(report.keys[0].maskedKey).toContain("...");
  });

  it("POST /api/projects/:projectId/models/keys/reset clears cooldowns and evictions", async () => {
    // Populate rotator and mark keys in cooldown & evicted
    const rotator = t.deps.keyHealthService.getRotator(
      projectId,
      "deepseek/deepseek-chat",
      "sk-proj-key-alpha, sk-proj-key-beta",
    );
    rotator.markRateLimited("sk-proj-key-alpha", 60_000);
    rotator.markFailed("sk-proj-key-beta");

    // Verify health reflects cooldown & eviction
    const healthRes = await api.get(
      `/api/projects/${projectId}/models/keys/health?provider=deepseek&modelId=deepseek-chat`,
    );
    expect(healthRes.status).toBe(200);
    const reportBefore = await healthRes.json();
    expect(reportBefore.cooldownCount).toBe(1);
    expect(reportBefore.evictedCount).toBe(1);

    // Call reset endpoint
    const resetRes = await api.post(`/api/projects/${projectId}/models/keys/reset`, {
      provider: "deepseek",
      modelId: "deepseek-chat",
    });
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.ok).toBe(true);
    expect(resetBody.report.healthyCount).toBe(2);
    expect(resetBody.report.cooldownCount).toBe(0);
    expect(resetBody.report.evictedCount).toBe(0);
  });

  it("enforces authentication on key health and reset routes", async () => {
    const unauthed = apiClient(t.app, "");
    const getRes = await unauthed.get(
      `/api/projects/${projectId}/models/keys/health?provider=deepseek&modelId=deepseek-chat`,
    );
    expect(getRes.status).toBe(401);

    const postRes = await unauthed.post(`/api/projects/${projectId}/models/keys/reset`, {
      provider: "deepseek",
      modelId: "deepseek-chat",
    });
    expect(postRes.status).toBe(401);
  });
});
