/**
 * A server-driven Session's own credential (auth/session-token.ts, auth/session-scope.ts):
 * what `controlEnv` hands its tool subprocesses as PENGUIN_API_TOKEN. It reaches its Agent's
 * own sessions and the routes an Agent's commands call, holds the identity a request claims to
 * its own, and nothing else — no admin route, no other Agent's session, no hot update.
 */
import type { SessionEnv } from "../src/runtime/session-manager.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionCreateResponse, SessionsResponse } from "../src/api/types.js";
import { mintSessionToken } from "../src/auth/session-token.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";

describe("session credential", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let own: string;
  let sibling: string;
  let colleague: string;
  let credential: string;

  const create = async (agentId: string): Promise<string> => {
    const res = await admin.post(`/api/projects/${PROJECT}/agents/${agentId}/sessions`, {
      client: "cli",
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as SessionCreateResponse).session.sessionId;
  };

  beforeEach(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    // A model whose client constructs without a credential (see api-token.test.ts).
    expect(
      (
        await admin.put(`/api/projects/${PROJECT}/models`, {
          defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
          models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6", contextWindow: 128000 }],
        })
      ).status,
    ).toBe(200);
    expect(
      (await admin.post(`/api/projects/${PROJECT}/agents`, { agentId: "helper" })).status,
    ).toBe(201);
    own = await create("default_agent");
    sibling = await create("default_agent");
    colleague = await create("helper");
    const env = t.deps.tree.api<SessionEnv>("SessionRuntimeModule", "SessionEnv");
    credential = env.controlEnv({
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: own,
    }).PENGUIN_API_TOKEN!;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  const as = (token: string, apiPath: string, init: { method?: string; body?: unknown } = {}) =>
    t.app.request(apiPath, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
  const code = async (res: Response) =>
    ((await res.json()) as { error?: { code?: string } }).error?.code;

  it("controlEnv hands the Session its own credential, never the boot token", () => {
    expect(credential.startsWith("pst1.")).toBe(true);
    expect(credential).not.toBe(t.deps.authService.localApiToken());
  });

  it("reads its own Agent's sessions and no other Agent's", async () => {
    expect((await as(credential, `/api/sessions/${sibling}`)).status).toBe(200);
    const foreign = await as(credential, `/api/sessions/${colleague}`);
    expect(foreign.status).toBe(403);
    expect(await code(foreign)).toBe("session_scope");
    expect((await as(credential, `/api/sessions/${colleague}/messages`)).status).toBe(403);

    const mine = await as(credential, `/api/projects/${PROJECT}/agents/default_agent/sessions`);
    expect(mine.status).toBe(200);
    const ids = ((await mine.json()) as SessionsResponse).sessions.map((s) => s.sessionId);
    expect(ids).toEqual(expect.arrayContaining([own, sibling]));
    const theirs = await as(credential, `/api/projects/${PROJECT}/agents/helper/sessions`);
    expect(theirs.status).toBe(200);
    expect(((await theirs.json()) as SessionsResponse).sessions).toEqual([]);
  });

  it("a Session it creates is one of its own", async () => {
    const res = await as(credential, `/api/projects/${PROJECT}/agents/helper/sessions`, {
      method: "POST",
      body: { client: "cli" },
    });
    expect(res.status).toBe(201);
    const made = ((await res.json()) as SessionCreateResponse).session.sessionId;
    expect((await as(credential, `/api/sessions/${made}`)).status).toBe(200);
    const theirs = await as(credential, `/api/projects/${PROJECT}/agents/helper/sessions`);
    const ids = ((await theirs.json()) as SessionsResponse).sessions.map((s) => s.sessionId);
    expect(ids).toEqual([made]);
    expect((await as(credential, `/api/sessions/${colleague}`)).status).toBe(403);
  });

  it("admin routes, hot updates, other Projects and routes outside the table are refused", async () => {
    for (const [method, apiPath] of [
      ["GET", "/api/admin/users"],
      ["GET", "/api/admin/settings"],
      ["GET", `/api/projects/${PROJECT}/models`],
      ["GET", `/api/projects/${PROJECT}/agents/default_agent/config`],
      ["GET", `/api/projects/other_project/agents`],
      ["GET", "/api/hmr/status"],
    ] as const) {
      const res = await as(credential, apiPath, { method });
      expect(res.status, `${method} ${apiPath}`).toBe(403);
    }
    const put = await as(credential, "/api/admin/settings", {
      method: "PUT",
      body: { telemetry: true },
    });
    expect(put.status).toBe(403);
  });

  it("the identity an organization request claims is held to the credential", async () => {
    const messages = `/api/projects/${PROJECT}/organizations/acme/channels/general/messages`;
    const post = (body: Record<string, unknown>) =>
      as(credential, messages, { method: "POST", body: { text: "hi", ...body } });
    // Another Agent, another Agent's session, or no claim at all: refused before the route.
    for (const body of [{ agentId: "helper" }, { sessionId: colleague }, {}] as Record<
      string,
      unknown
    >[]) {
      const res = await post(body);
      expect(res.status, JSON.stringify(body)).toBe(403);
      expect(await code(res)).toBe("session_scope");
    }
    // Its own claims pass the gate; the route itself then answers (no such organization).
    const res = await post({ agentId: "default_agent", sessionId: own });
    expect(await code(res)).not.toBe("session_scope");
    // A read's query claims are held the same way.
    const read = await as(
      credential,
      `/api/projects/${PROJECT}/organizations/acme/channels?agentId=helper`,
    );
    expect(read.status).toBe(403);
  });

  it("ticket attach names the Session to attach, and holds only the caller to the credential", async () => {
    const attach = `/api/projects/${PROJECT}/organizations/acme/tickets/2026-09-30-t/attach`;
    const post = (body: Record<string, unknown>) =>
      as(credential, attach, { method: "POST", body });
    // A colleague's session is what gets attached, not a claim: the gate lets the route judge.
    const res = await post({
      sessionId: colleague,
      callerSessionId: own,
      agentId: "default_agent",
    });
    expect(await code(res)).not.toBe("session_scope");
    // The caller's own claims are still held: a colleague's session or Agent as the caller is not.
    for (const body of [
      { sessionId: colleague, callerSessionId: colleague },
      { sessionId: own, agentId: "helper" },
      { sessionId: own },
    ] as Record<string, unknown>[]) {
      const refused = await post(body);
      expect(refused.status, JSON.stringify(body)).toBe(403);
      expect(await code(refused)).toBe("session_scope");
    }
  });

  it("a desk's credential reaches its own organization only", async () => {
    const desk = mintSessionToken(t.deps.authService.localApiToken()!, {
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: own,
      orgId: "acme",
    });
    const res = await as(desk, `/api/projects/${PROJECT}/organizations/other/tickets`);
    expect(res.status).toBe(403);
    expect(await code(res)).toBe("session_scope");
    const mine = await as(desk, `/api/projects/${PROJECT}/organizations/acme/tickets`);
    expect(await code(mine)).not.toBe("session_scope");
  });

  it("a forged credential, or one another boot signed, is 401", async () => {
    const [head, , mac] = credential.split(".");
    const forged = `${head}.${Buffer.from(
      JSON.stringify({ projectId: PROJECT, agentId: "helper", sessionId: colleague }),
    ).toString("base64url")}.${mac}`;
    expect((await as(forged, "/api/me")).status).toBe(401);
    const otherBoot = mintSessionToken("another-boot-token", {
      projectId: PROJECT,
      agentId: "default_agent",
      sessionId: own,
    });
    expect((await as(otherBoot, "/api/me")).status).toBe(401);
  });
});
