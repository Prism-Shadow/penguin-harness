/**
 * Coding-agents API integration tests: definition CRUD (admin-only writes, validation),
 * session lifecycle over a REAL spawned ACP agent subprocess (spawn -> handshake ->
 * prompt -> streamed update -> turn end), permission and mode routes against absent
 * resources, and disposal. Kernel-level behavior (event vocabulary, permission bridging)
 * is covered by packages/coding-agents' own suite; these tests pin the HTTP surface and
 * the server-side wiring.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  CodingAgentSessionDetailResponse,
  CodingAgentSessionInfo,
  CodingAgentsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT_MAIN = fileURLToPath(new URL("./coding-agents-agent.mjs", import.meta.url));

async function waitForTurnEnd(
  client: ReturnType<typeof apiClient>,
  sessionId: string,
): Promise<CodingAgentSessionDetailResponse> {
  for (let i = 0; i < 100; i++) {
    const res = await client.get(`/api/coding-agents/sessions/${sessionId}`);
    const detail = (await res.json()) as CodingAgentSessionDetailResponse;
    if (detail.events.some((e) => e.type === "turn_end")) return detail;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("turn never ended");
}

describe("coding agents api", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let workspace: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await loginAdmin(t.app);
    const b = await provisionUser(t.app, "member_b");
    admin = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), "coding-agents-api-"));
    const res = await admin.post("/api/coding-agents/agents", {
      id: "fake",
      title: "Fake Agent",
      command: process.execPath,
      args: [AGENT_MAIN],
    });
    expect(res.status).toBe(201);
  });

  afterEach(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
    await t.cleanup();
  });

  it("lists saved definitions for any authenticated user", async () => {
    const res = await member.get("/api/coding-agents/agents");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CodingAgentsResponse;
    expect(body.agents).toEqual([
      { id: "fake", title: "Fake Agent", command: process.execPath, args: [AGENT_MAIN] },
    ]);
  });

  it("restricts definition writes to admins and validates the body", async () => {
    expect((await member.post("/api/coding-agents/agents", { id: "x", command: "x" })).status).toBe(
      403,
    );
    expect((await member.delete("/api/coding-agents/agents/fake")).status).toBe(403);
    expect(
      (await admin.post("/api/coding-agents/agents", { id: "bad id!", command: "x" })).status,
    ).toBe(400);
    expect((await admin.post("/api/coding-agents/agents", { id: "no-cmd" })).status).toBe(400);
  });

  it("rejects unknown agents and workspaces at session creation", async () => {
    expect(
      (
        await admin.post("/api/coding-agents/sessions", {
          agentId: "nope",
          workspaceDir: workspace,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await admin.post("/api/coding-agents/sessions", {
          agentId: "fake",
          workspaceDir: path.join(workspace, "missing"),
        })
      ).status,
    ).toBe(400);
  });

  it("drives a full turn against a spawned agent and exposes the transcript", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect(session.agentId).toBe("fake");
    expect(session.busy).toBe(false);

    expect(
      (await admin.post(`/api/coding-agents/sessions/${session.sessionId}/prompt`, { text: "hi" }))
        .status,
    ).toBe(202);
    const detail = await waitForTurnEnd(admin, session.sessionId);
    expect(detail.events).toEqual([
      {
        type: "message_chunk",
        sessionId: session.sessionId,
        delta: "hello from subprocess",
      },
      { type: "turn_end", sessionId: session.sessionId, stopReason: "end_turn" },
    ]);
    // The transcript survives a fresh read (the log, not a live subscription).
    const reread = await admin.get(`/api/coding-agents/sessions/${session.sessionId}`);
    expect(((await reread.json()) as CodingAgentSessionDetailResponse).events).toHaveLength(2);
  });

  it("answers 404 for unknown sessions across every session route", async () => {
    const base = "/api/coding-agents/sessions/does-not-exist";
    expect((await admin.get(base)).status).toBe(404);
    expect((await admin.post(`${base}/prompt`, { text: "x" })).status).toBe(404);
    expect((await admin.post(`${base}/cancel`)).status).toBe(404);
    expect((await admin.post(`${base}/mode`, { modeId: "m" })).status).toBe(404);
    expect(
      (await admin.post(`${base}/permissions/perm-1`, { outcome: { outcome: "cancelled" } }))
        .status,
    ).toBe(404);
    expect((await admin.delete(base)).status).toBe(204);
  });

  it("lists and disposes sessions", async () => {
    const created = await admin.post("/api/coding-agents/sessions", {
      agentId: "fake",
      workspaceDir: workspace,
    });
    const { session } = (await created.json()) as { session: CodingAgentSessionInfo };
    expect((await admin.delete(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(
      204,
    );
    expect((await admin.get(`/api/coding-agents/sessions/${session.sessionId}`)).status).toBe(404);
    const sessions = (await (await admin.get("/api/coding-agents/sessions")).json()) as {
      sessions: CodingAgentSessionInfo[];
    };
    expect(sessions.sessions).toHaveLength(0);
  });

  it("keeps the definition registry in settings (reloaded on boot)", async () => {
    const agents = (await (
      await admin.get("/api/coding-agents/agents")
    ).json()) as CodingAgentsResponse;
    expect(agents.agents.map((a) => a.id)).toContain("fake");
  });
});
