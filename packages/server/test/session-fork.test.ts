/**
 * Model-switch fork route: POST /api/sessions/:sessionId/fork creates a NEW Session on
 * another model carrying the source conversation (sanitized). Covers the happy path
 * (DB row copied: approval mode + title; messages carried without thinking/usage),
 * 400 on a half reference / unknown pair, 404 on an unknown session, and the 409
 * running/compacting guard (service-level, manager stubbed).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  requestBegin,
  requestEnd,
  sessionMeta,
  thinkingMessage,
  tokenUsage,
  userText,
} from "@prismshadow/penguin-core";
import type {
  MessagesResponse,
  SessionCreateResponse,
  SessionForkResponse,
} from "../src/api/types.js";
import { SessionService } from "../src/services/session-service.js";
import type { SessionManager } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SOURCE = { provider: "anthropic", modelId: "claude-sonnet-4-6" };
const TARGET = { provider: "anthropic", modelId: "claude-haiku-4-5" };

describe("session fork (model switch)", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = () => `/api/projects/${projectId}/agents/default_agent/sessions`;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "alice");
    api = apiClient(t.app, cookie);
    const created = (await (
      await api.post("/api/projects", { projectId: "alice-fork", name: "fork project" })
    ).json()) as { project: { projectId: string } };
    projectId = created.project.projectId;
    const res = await api.put(`/api/projects/${projectId}/models`, {
      defaultModel: SOURCE,
      models: [
        { ...SOURCE, contextWindow: 128000 },
        { ...TARGET, contextWindow: 200000 },
      ],
    });
    expect(res.status).toBe(200);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /** Creates a source Session over HTTP and writes a conversation Trace for it. */
  async function makeSource(): Promise<{ sessionId: string; workspace: string }> {
    const res = await api.post(base(), {});
    expect(res.status).toBe(201);
    const { session } = (await res.json()) as SessionCreateResponse;
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-02", session.sessionId, 1, [
      sessionMeta({
        session_id: session.sessionId,
        provider: SOURCE.provider,
        model_id: SOURCE.modelId,
        model_context_window: 128000,
        system_prompt: "SP",
        tools: [],
        agent_state: "/tmp/a",
        workspace: session.workspace,
      }),
      userText("hello"),
      requestBegin(),
      thinkingMessage("secret", "completed", { signature: "sig" }),
      assistantText("hi", "completed", { phase: "answer" }),
      requestEnd("completed"),
      tokenUsage(
        { cache_read: 0, cache_write: 0, output: 1, total: 10 },
        { cache_read: 0, cache_write: 0, output: 1, total: 10 },
      ),
    ]);
    return { sessionId: session.sessionId, workspace: session.workspace };
  }

  it("forks onto the target model: new row copies mode+title; messages carried sanitized", async () => {
    const src = await makeSource();
    await api.patch(`/api/sessions/${src.sessionId}`, {
      title: "My chat",
      approvalMode: "read-only",
    });

    const res = await api.post(`/api/sessions/${src.sessionId}/fork`, TARGET);
    expect(res.status).toBe(201);
    const body = (await res.json()) as SessionForkResponse;
    expect(body.forkedFrom).toBe(src.sessionId);
    expect(body.session.sessionId).not.toBe(src.sessionId);
    expect(body.session.provider).toBe(TARGET.provider);
    expect(body.session.modelId).toBe(TARGET.modelId);
    expect(body.session.workspace).toBe(src.workspace);
    expect(body.session.title).toBe("My chat");
    expect(body.session.approvalMode).toBe("read-only");
    expect(body.session.hasTrace).toBe(true);
    expect(body.session.status).toBe("idle");

    // The forked Trace serves the carried conversation like any reopened session — with
    // thinking, fidelity, and token_usage sanitized away and forked_from in the meta.
    const messages = (await (
      await api.get(`/api/sessions/${body.session.sessionId}/messages`)
    ).json()) as MessagesResponse;
    const types = messages.messages.map((m) => (m.payload as { type?: string }).type ?? m.type);
    expect(types).toContain("text");
    expect(types).not.toContain("thinking");
    expect(types).not.toContain("token_usage");
    expect(JSON.stringify(messages)).not.toContain("fidelity");
    const meta = messages.messages.find((m) => m.type === "session_meta");
    expect((meta?.payload as { forked_from?: string }).forked_from).toBe(src.sessionId);
    // The source session is untouched and still listed alongside the fork.
    const srcMessages = (await (
      await api.get(`/api/sessions/${src.sessionId}/messages`)
    ).json()) as MessagesResponse;
    expect(
      srcMessages.messages.some((m) => (m.payload as { type?: string }).type === "thinking"),
    ).toBe(true);
  });

  it("400 when the model reference is half or names no configured entry", async () => {
    const src = await makeSource();
    const half = await api.post(`/api/sessions/${src.sessionId}/fork`, {
      modelId: TARGET.modelId,
    });
    expect(half.status).toBe(400);
    const unknown = await api.post(`/api/sessions/${src.sessionId}/fork`, {
      modelId: "no-such-model",
      provider: "anthropic",
    });
    expect(unknown.status).toBe(400);
    const body = (await unknown.json()) as { error: { code: string } };
    expect(body.error.code).toBe("session_fork_failed");
  });

  it("400 when the source session has no trace yet", async () => {
    const res = await api.post(base(), {});
    const { session } = (await res.json()) as SessionCreateResponse;
    const fork = await api.post(`/api/sessions/${session.sessionId}/fork`, TARGET);
    expect(fork.status).toBe(400);
    const body = (await fork.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("session_fork_failed");
    expect(body.error.message).toMatch(/no Trace record/);
  });

  it("404 for an unknown session", async () => {
    const res = await api.post("/api/sessions/session-ghost/fork", TARGET);
    expect(res.status).toBe(404);
  });

  it("409 while the source is running or compacting (assertIdle semantics)", async () => {
    const src = await makeSource();
    const row = t.deps.sessionsRepo.findById(src.sessionId)!;
    const serviceWith = (status: "running" | "compacting") =>
      new SessionService({
        root: t.root,
        sessions: t.deps.sessionsRepo,
        manager: { statusOf: () => status } as unknown as SessionManager,
        projectConfig: t.deps.projectConfigService,
        sources: t.deps.sessionSources,
      });
    const running = await serviceWith("running")
      .forkSession({ row, ...TARGET })
      .catch((e: unknown) => e);
    expect((running as { status: number; code: string }).status).toBe(409);
    expect((running as { code: string }).code).toBe("task_in_progress");
    const compacting = await serviceWith("compacting")
      .forkSession({ row, ...TARGET })
      .catch((e: unknown) => e);
    expect((compacting as { status: number; code: string }).status).toBe(409);
    expect((compacting as { code: string }).code).toBe("compacting");
  });

  it("rejects an invalid per-task thinkingLevel with 400 (five names only)", async () => {
    const src = await makeSource();
    const res = await api.post(`/api/sessions/${src.sessionId}/tasks`, {
      input: [{ type: "text", text: "hi" }],
      thinkingLevel: "ultra",
    });
    expect(res.status).toBe(400);
  });
});
