/**
 * Requests to a Project model outside a chat turn (ProjectModelRequests), as a plugin makes them:
 * a test plugin requires the interface in its manifest and serves one route over it, and the
 * model is a loopback MMSP server.
 *
 * - Given a Session's tool request, the model sees the row's key and PenguinHarness's User-Agent,
 *   the events come back, and one usage row lands on that Session and its Agent with the
 *   request's purpose and buckets — so it is priced into the Session's cost.
 * - Given a request with no Session, its row carries the Project only.
 * - Given a response MMSP rejects after it was paid for, the reader gets the error and the row
 *   still carries the reported usage.
 * - Given a request that fails before any usage (a model that goes silent past its idle
 *   timeout), the reader gets the timeout and the row is 0 tokens with a failed status.
 * - Given the reader stops after the first event, the row says `aborted`.
 * - Given a Session of another Project, or a model the Project does not configure, nothing is
 *   sent and nothing is recorded.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import type { UniEvent } from "@prismshadow/mmsp";
import { PluginHost } from "../src/plugin/host.js";
import type { ProjectModelRequests } from "../src/services/project-model-requests.js";
import type { AppEnv } from "../src/auth/middleware.js";
import type { SessionCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, type TestApp } from "./helpers.js";
import { startMmspServer, textReply, type MmspServer } from "./fixtures/mmsp-server.js";

const PROJECT = "default_project";
const MODEL = { provider: "custom", modelId: "tool-model" };
const USAGE = { cached_tokens: 10, prompt_tokens: 200, thoughts_tokens: 30, response_tokens: 40 };

/** A plugin whose one route runs a request through ProjectModelRequests and answers its text. */
function toolsPlugin(): ModuleDef {
  return {
    manifest: parseManifest({
      name: "AcmeTools",
      requires: {
        requests: {
          iface: "@prismshadow/penguin-server#ProjectModelRequests",
          from: "ModelToolsModule",
        },
      },
      provides: {},
      contributes: {
        "HttpModule.routes": [{ id: "acme.routes", prefix: "/api/acme", auth: "user", order: 900 }],
      },
      children: [],
    }),
    create({ use }) {
      const requests = use.requests as ProjectModelRequests;
      const app = new Hono<AppEnv>();
      app.post("/run", async (c) => {
        const body = (await c.req.json()) as {
          sessionId?: string;
          model: { provider: string; modelId: string };
          text: string;
          stopAfterFirst?: boolean;
          idleTimeoutMs?: number;
        };
        const stop = new AbortController();
        let text = "";
        try {
          for await (const event of requests.stream(
            {
              projectId: PROJECT,
              ...(body.sessionId !== undefined ? { sessionId: body.sessionId } : {}),
              purpose: "@acme/tools:t2t",
            },
            body.model,
            {
              messages: [{ role: "user", content_items: [{ type: "text.done", text: body.text }] }],
              signal: stop.signal,
              ...(body.idleTimeoutMs !== undefined ? { idleTimeoutMs: body.idleTimeoutMs } : {}),
            },
          )) {
            for (const item of (event as UniEvent).content_items) {
              if (item.type === "text.done") text += item.text;
            }
            if (body.stopAfterFirst) break;
          }
          return c.json({ text });
        } catch (err) {
          const status = (err as { status?: number }).status;
          return c.json(
            { error: err instanceof Error ? err.name : String(err), status: status ?? null },
            200,
          );
        }
      });
      return { api: {}, bind: { "acme.routes": app } };
    },
  };
}

interface UsageRow {
  session_id: string;
  agent_id: string;
  purpose: string | null;
  cache_read: number;
  cache_write: number;
  output: number;
  status: string;
}

describe("requests to a Project model outside a chat turn", () => {
  let t: TestApp;
  let mmsp: MmspServer;
  let api: ReturnType<typeof apiClient>;
  let sessionId: string;
  const rows = (): UsageRow[] =>
    t.deps.db
      .prepare(
        "SELECT session_id, agent_id, purpose, cache_read, cache_write, output, status FROM usage_records WHERE purpose IS NOT NULL ORDER BY id",
      )
      .all() as unknown as UsageRow[];
  const lastRow = (): UsageRow | undefined => rows().at(-1);
  const run = async (body: Record<string, unknown>) =>
    (await (await api.post("/api/acme/run", { model: MODEL, ...body })).json()) as {
      text?: string;
      error?: string;
      status?: number | null;
    };

  beforeAll(async () => {
    mmsp = await startMmspServer((request) => {
      const prompt = request.messages[0]?.content_items[0]?.text;
      if (prompt === "silent") return { hang: true };
      if (prompt === "rejected") {
        return {
          events: [],
          error: {
            type: "EmptyResponseError",
            message: "returned no content other than thinking",
            usage_metadata: USAGE,
          },
        };
      }
      return textReply(`echo: ${prompt}`, USAGE);
    });
    const host = new PluginHost();
    host.use({ specifier: "@acme/tools", modules: [toolsPlugin()], replaces: [] });
    t = await createTestApp({ plugins: host });
    api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const configured = await api.put(`/api/projects/${PROJECT}/models`, {
      providers: { custom: { clientType: "mmsp", baseUrl: mmsp.baseUrl, apiKey: "sk-tool-key" } },
      models: [
        { ...MODEL, pricing: { cacheRead: 1, cacheWrite: 2, output: 4 } },
        { provider: "custom", modelId: "chat-model" },
      ],
      defaultModel: { provider: "custom", modelId: "chat-model" },
    });
    expect(configured.status).toBe(200);
    const created = await api.post(`/api/projects/${PROJECT}/agents/default_agent/sessions`, {});
    expect(created.status).toBe(201);
    sessionId = ((await created.json()) as SessionCreateResponse).session.sessionId;
  });

  afterAll(async () => {
    await mmsp?.close();
    await t?.cleanup();
  });

  it("a Session's tool request reaches the model as chat would and is billed to the Session once", async () => {
    expect(await run({ sessionId, text: "hello" })).toEqual({ text: "echo: hello" });
    const sent = mmsp.requests.at(-1)!;
    expect(sent.model).toBe("tool-model");
    expect(sent.headers.authorization).toBe("Bearer sk-tool-key");
    expect(sent.headers["user-agent"]).toMatch(/^penguinharness\//);
    expect(sent.config.session_id).toBe(sessionId);
    expect(rows().filter((row) => row.session_id === sessionId)).toEqual([
      {
        session_id: sessionId,
        agent_id: "default_agent",
        purpose: "@acme/tools:t2t",
        cache_read: 10,
        cache_write: 200,
        output: 70,
        status: "completed",
      },
    ]);
    const cost = await t.deps.usageService.costBySession(
      PROJECT,
      [sessionId],
      "2000-01-01T00:00:00.000Z",
      "2100-01-01T00:00:00.000Z",
    );
    // (10 × 1 + 200 × 2 + 70 × 4) / 1e6
    expect(cost.bySession.get(sessionId)).toBeCloseTo(690 / 1e6, 12);
  });

  it("a request with no Session is recorded on the Project alone", async () => {
    expect(await run({ text: "no session" })).toEqual({ text: "echo: no session" });
    expect(lastRow()).toMatchObject({ session_id: "", agent_id: "", status: "completed" });
  });

  it("a response rejected after it was paid for reaches the reader, and its usage is billed", async () => {
    expect(await run({ sessionId, text: "rejected" })).toMatchObject({ error: "UpstreamError" });
    expect(lastRow()).toMatchObject({ session_id: sessionId, cache_write: 200, output: 70 });
  });

  it("a model that goes silent past the idle timeout fails the request with nothing billed", async () => {
    expect(await run({ sessionId, text: "silent", idleTimeoutMs: 100 })).toMatchObject({
      error: "ModelIdleTimeoutError",
    });
    expect(lastRow()).toMatchObject({ cache_write: 0, output: 0, status: "fatal" });
  });

  it("a reader that stops after the first event leaves an aborted row", async () => {
    expect(await run({ sessionId, text: "short", stopAfterFirst: true })).toEqual({
      text: "echo: short",
    });
    expect(lastRow()).toMatchObject({ output: 0, status: "aborted" });
  });

  it("a Session of another Project, or an unconfigured model, sends and records nothing", async () => {
    const sentBefore = mmsp.requests.length;
    const rowsBefore = rows().length;
    expect(await run({ sessionId: "session-2026-01-01-00-00-00-00000000", text: "x" })).toEqual({
      error: "HttpError",
      status: 404,
    });
    expect(
      await run({ model: { provider: "custom", modelId: "not-configured" }, text: "x" }),
    ).toEqual({ error: "HttpError", status: 400 });
    expect(mmsp.requests.length).toBe(sentBefore);
    expect(rows().length).toBe(rowsBefore);
  });
});
