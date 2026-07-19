/**
 * Integration tests for the Session index: creation (default model / workspace
 * guard), listing (DB union Trace directory discovery), PATCH approval mode,
 * and createdAt parsing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import type {
  ProjectCreateResponse,
  SessionCreateResponse,
  SessionResponse,
  SessionsResponse,
} from "../src/api/types.js";
import { sessionIdCreatedAt } from "../src/services/session-service.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("session-index", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = () => `/api/projects/${projectId}/agents/default_agent/sessions`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-index", name: "测试项目" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function configureModels(): Promise<void> {
    const res = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
    });
    expect(res.status).toBe(200);
  }

  it("未配置默认模型时创建 Session → 400 no_default_model", async () => {
    // A newly created Project comes with a default model preset: first replace
    // the whole table to clear it (omitting defaultModel + the original default
    // absent from models = removes default_model), then verify the
    // no-default-model error path.
    const cleared = await api.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-no-default" }],
    });
    expect(cleared.status).toBe(200);
    const res = await api.post(base(), {});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("no_default_model");
  });

  it("模型没有可用 credential 时创建 Session → 400 model_credential_missing", async () => {
    // A model using the OpenAI protocol: the SDK requires a credential as soon as
    // the client is constructed. Clear the environment variable key so none is
    // available — the error must carry an **error code** (the frontend renders
    // localized text from the code, not by parsing the Chinese message).
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await api.put(`/api/projects/${projectId}/models`, {
        defaultModel: { provider: "custom", modelId: "no-key-model" },
        models: [{ provider: "custom", modelId: "no-key-model", clientType: "openai" }],
      });
      const res = await api.post(base(), {});
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("model_credential_missing");
      // The raw SDK message (littered with the env var name) must not leak.
      expect(body.error.message).not.toMatch(/OPENAI_API_KEY/);
      expect(body.error.message).toContain("no-key-model");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  it("创建 Session：缺省自动临时 Workspace、默认 allow-all、进列表", async () => {
    await configureModels();
    const res = await api.post(base(), {});
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as SessionCreateResponse;
    expect(session.sessionId).toMatch(/^session-\d{4}-/);
    expect(session.modelId).toBe("claude-sonnet-4-6");
    expect(session.approvalMode).toBe("allow-all");
    expect(session.status).toBe("idle");
    expect(session.hasTrace).toBe(false);
    // The temporary Workspace lives inside this Agent's workspaces directory.
    expect(session.workspace).toContain(path.join(projectId, "agents", "default_agent", "workspaces"));

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.map((s) => s.sessionId)).toContain(session.sessionId);
  });

  it("显式 Workspace 只要求已存在，可在 Project 目录之外", async () => {
    await configureModels();
    const inside = path.join(t.root, projectId, "my-workdir");
    await fs.mkdir(inside, { recursive: true });
    const ok = await api.post(base(), { workspace: inside });
    expect(ok.status).toBe(201);
    const { session } = (await ok.json()) as SessionCreateResponse;
    expect(session.workspace).toBe(await fs.realpath(inside));

    // An existing directory outside the Project directory is likewise allowed (reachability is left to file permissions).
    const outside = path.join(t.root, "not-a-project");
    await fs.mkdir(outside, { recursive: true });
    const okOutside = await api.post(base(), { workspace: outside });
    expect(okOutside.status).toBe(201);

    // A nonexistent directory is still 400 (not auto-created).
    expect(
      (await api.post(base(), { workspace: path.join(t.root, projectId, "ghost") })).status,
    ).toBe(400);
  });

  it("列表并集：Trace 目录发现未纳管 Session 并补插索引行", async () => {
    await configureModels();
    const discovered = "session-2026-07-01-08-30-00-deadbeef";
    const meta: SessionMetaPayload = {
      session_id: discovered,
      model_id: "cli-model",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: "/tmp/cli-workspace",
    };
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-01", discovered, 1, [
      sessionMeta(meta),
      userText("cli 会话"),
    ]);

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    const found = list.sessions.find((s) => s.sessionId === discovered);
    expect(found).toBeDefined();
    expect(found!.modelId).toBe("cli-model");
    expect(found!.workspace).toBe("/tmp/cli-workspace");
    expect(found!.approvalMode).toBe("allow-all");
    expect(found!.hasTrace).toBe(true);
    expect(found!.createdAt).toBe(sessionIdCreatedAt(discovered));

    // Already indexed: visible via the single-lookup endpoint.
    const single = await api.get(`/api/sessions/${discovered}`);
    expect(single.status).toBe(200);
  });

  it("DELETE Session：清索引行与全部 Trace 分片，列表不复活；重删 404", async () => {
    await configureModels();
    const { session } = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    const sessionId = session.sessionId;
    // Create a Trace spanning multiple dated shards: deletion must clear all of
    // them, or the listing's directory discovery would resurrect the session.
    const meta: SessionMetaPayload = {
      session_id: sessionId,
      model_id: "anthropic/claude-sonnet-4-6",
      provider: "custom",
      model_context_window: 1000,
      system_prompt: "",
      tools: [],
      thinking_level: "default",
      agent_state: "/tmp/a",
      workspace: session.workspace,
    };
    const f1 = await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-07-01",
      sessionId,
      1,
      [sessionMeta(meta), userText("第一轮")],
    );
    const f2 = await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-07-02",
      sessionId,
      2,
      [sessionMeta(meta), userText("第二轮")],
    );

    const del = await api.delete(`/api/sessions/${sessionId}`);
    expect(del.status).toBe(204);

    await expect(fs.stat(f1)).rejects.toThrow();
    await expect(fs.stat(f2)).rejects.toThrow();

    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions.map((s) => s.sessionId)).not.toContain(sessionId);
    expect((await api.delete(`/api/sessions/${sessionId}`)).status).toBe(404);
    expect((await api.get(`/api/sessions/${sessionId}`)).status).toBe(404);
  });

  it("DELETE Session：Workspace 目录不随删除清除（用户自带目录必须保留）", async () => {
    await configureModels();
    const inside = path.join(t.root, projectId, "keep-me");
    await fs.mkdir(inside, { recursive: true });
    const { session } = (await (
      await api.post(base(), { workspace: inside })
    ).json()) as SessionCreateResponse;

    expect((await api.delete(`/api/sessions/${session.sessionId}`)).status).toBe(204);
    expect((await fs.stat(inside)).isDirectory()).toBe(true);
  });

  it("列表按 createdAt 降序", async () => {
    await configureModels();
    const older = "session-2020-01-01-00-00-00-00000001";
    await writeTraceFile(t.root, projectId, "default_agent", "2020-01-01", older, 1, [
      sessionMeta({
        session_id: older,
        model_id: "m",
        provider: "custom",
        model_context_window: 1,
        system_prompt: "",
        tools: [],
        thinking_level: "default",
        agent_state: "/a",
        workspace: "/w",
      }),
    ]);
    const created = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    const list = (await (await api.get(base())).json()) as SessionsResponse;
    expect(list.sessions[0]!.sessionId).toBe(created.session.sessionId);
    expect(list.sessions[list.sessions.length - 1]!.sessionId).toBe(older);
  });

  it("PATCH 审批模式即存并回读", async () => {
    await configureModels();
    const { session } = (await (await api.post(base(), {})).json()) as SessionCreateResponse;
    // Change from the default allow-all to a different mode, to confirm it's actually persisted.
    const patched = await api.patch(`/api/sessions/${session.sessionId}`, {
      approvalMode: "always-ask",
    });
    expect(patched.status).toBe(200);
    const got = (await (
      await api.get(`/api/sessions/${session.sessionId}`)
    ).json()) as SessionResponse;
    expect(got.session.approvalMode).toBe("always-ask");
    // An invalid mode returns 400.
    expect(
      (await api.patch(`/api/sessions/${session.sessionId}`, { approvalMode: "sometimes" })).status,
    ).toBe(400);
  });

  it("insertOrIgnore 幂等：并发首次发现同一 Session 不因 UNIQUE 约束抛错", async () => {
    const row = {
      sessionId: "session-2026-07-02-00-00-00-11223344",
      projectId,
      agentId: "default_agent",
      modelId: "cli-model",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "always-ask" as const,
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insertOrIgnore(row);
    // A second insert with different fields for the same id: silently ignored, no throw, first-inserted value is kept.
    expect(() =>
      t.deps.sessionsRepo.insertOrIgnore({ ...row, modelId: "other-model" }),
    ).not.toThrow();
    expect(t.deps.sessionsRepo.findById(row.sessionId)!.modelId).toBe("cli-model");
  });

  it("sessionIdCreatedAt：非法格式返回 null", () => {
    expect(sessionIdCreatedAt("session-2026-07-01-08-30-00-deadbeef")).toBe(
      new Date(2026, 6, 1, 8, 30, 0).toISOString(),
    );
    expect(sessionIdCreatedAt("not-a-session")).toBeNull();
  });
});
