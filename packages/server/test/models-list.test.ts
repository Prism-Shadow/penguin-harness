/**
 * Endpoint model listing (POST /api/projects/:p/models/list): the service collapses every
 * failure into `{ ok:false }` (UnsupportedOperationError additionally flagged, listings
 * bounded in time), and the route validates shape/ownership before anything is fetched.
 */
import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EndpointModelListResponse, ProjectCreateResponse } from "../src/api/types.js";
import { ProjectConfigService } from "../src/services/project-config-service.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { wire } from "@prismshadow/penguin-core/kernel";

describe("ProjectConfigService.listEndpointModels", () => {
  let root: string;
  let service: ProjectConfigService;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "penguin-models-list-"));
    service = wire(ProjectConfigService, { config: { root } });
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const req = { baseUrl: "https://gw.example/v1", clientType: "openai", apiKey: "sk-l1" };

  it("returns the listing verbatim and canonicalizes the legacy openai spelling", async () => {
    const calls: unknown[] = [];
    const res = await service.listEndpointModels(req, async (options) => {
      calls.push(options);
      return ["m-b", "m-a", "m-b"];
    });
    expect(res).toEqual({ ok: true, models: ["m-b", "m-a", "m-b"] });
    expect(calls).toEqual([
      { clientType: "openai-chat", baseUrl: "https://gw.example/v1", apiKey: "sk-l1" },
    ]);
  });

  it("omits an absent key so the SDK's environment fallback applies", async () => {
    const calls: Record<string, unknown>[] = [];
    await service.listEndpointModels(
      { baseUrl: req.baseUrl, clientType: "ant-messages" },
      async (options) => {
        calls.push(options as unknown as Record<string, unknown>);
        return [];
      },
    );
    expect(calls[0]).toEqual({ clientType: "ant-messages", baseUrl: "https://gw.example/v1" });
  });

  it("flags AgentHub's UnsupportedOperationError so the dialog can point at the manual path", async () => {
    const res = await service.listEndpointModels(req, async () => {
      throw Object.assign(new Error("Claude5Client cannot list models"), {
        name: "UnsupportedOperationError",
      });
    });
    expect(res.ok).toBe(false);
    expect(res.unsupported).toBe(true);
    expect(res.message).toBe("Claude5Client cannot list models");
  });

  it("collapses SDK failures into ok:false with the reason truncated", async () => {
    const res = await service.listEndpointModels(req, async () => {
      throw new Error("x".repeat(400));
    });
    expect(res.ok).toBe(false);
    expect(res.unsupported).toBeUndefined();
    expect(res.message).toHaveLength(300);
  });

  it("reports a listing that outlives the bound as timed out", async () => {
    const res = await service.listEndpointModels(req, () => new Promise<string[]>(() => {}), 10);
    expect(res).toEqual({ ok: false, message: "model listing timed out" });
  });
});

describe("POST /api/projects/:p/models/list route validation", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const url = () => `/api/projects/${projectId}/models/list`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-list", name: "List project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("rejects a non-http(s) base URL and a missing clientType before anything is fetched", async () => {
    const noProto = await api.post(url(), { baseUrl: "gw.example/v1", clientType: "openai-chat" });
    expect(noProto.status).toBe(400);
    const noType = await api.post(url(), { baseUrl: "https://gw.example/v1" });
    expect(noType.status).toBe(400);
    const badKey = await api.post(url(), {
      baseUrl: "https://gw.example/v1",
      clientType: "openai-chat",
      apiKey: 42,
    });
    expect(badKey.status).toBe(400);
  });

  it("is owner-only, like the other probe routes", async () => {
    const { cookie } = await provisionUser(t.app, "bob");
    const member = apiClient(t.app, cookie);
    const res = await member.post(url(), {
      baseUrl: "https://gw.example/v1",
      clientType: "openai-chat",
    });
    expect([403, 404]).toContain(res.status);
  });

  it("responds with the service's DTO shape (fed by a stubbed lister)", async () => {
    const original = t.deps.projectConfigService.listEndpointModels.bind(
      t.deps.projectConfigService,
    );
    t.deps.projectConfigService.listEndpointModels = (r) => original(r, async () => ["m-1", "m-2"]);
    const res = await api.post(url(), {
      baseUrl: "https://gw.example/v1",
      clientType: "openai-chat",
      apiKey: "sk-route-1",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as EndpointModelListResponse;
    expect(body).toEqual({ ok: true, models: ["m-1", "m-2"] });
  });
});
