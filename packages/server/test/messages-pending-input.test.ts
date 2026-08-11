/**
 * GET /messages during the first run's bootstrap window (MCP connect + discovery): the
 * engine writes the input to the Trace only after the bootstrap, and the draft flow
 * subscribes to the stream only after the input publish — so history rebuilds during the
 * connect used to lose the user's own message. The manager now holds the published
 * inputs until the run ends and the messages endpoint appends whichever of them the
 * Trace read has not caught up to (exact-envelope dedup), and clears them at idle.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagesResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-10-10-00-00-eeff0002";

/**
 * Fake Session that parks before yielding anything (the bootstrap window: nothing has
 * reached the Trace yet — this fake writes no Trace at all) until the test releases it.
 */
function parkedBootstrapSession(sessionId: string, gate: Promise<void>): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      await gate;
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("GET /messages serves the running task's pending inputs", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let release!: () => void;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "pender");
    api = apiClient(t.app, cookie);
    const row: SessionRow = {
      sessionId: SID,
      projectId: "pender-default_project",
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.deps.manager.adopt(row, parkedBootstrapSession(SID, gate));
  });

  afterEach(async () => {
    release();
    await t.cleanup();
  });

  it("appends the input while the run has not reached the Trace, and stops after idle", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "hello mcp" }],
    });
    expect(res.status).toBe(202);

    // Mid-bootstrap: no Trace exists yet, but the endpoint serves the published input.
    const during = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    const texts = during.messages.map((m) => (m.payload as { text?: string }).text);
    expect(texts).toContain("hello mcp");

    // Windowed tail reads carry it the same way.
    const tail = (await (
      await api.get(`/api/sessions/${SID}/messages?tailLimit=10`)
    ).json()) as MessagesResponse;
    expect(tail.messages.map((m) => (m.payload as { text?: string }).text)).toContain("hello mcp");

    // No duplication: the pending input appears exactly once.
    expect(texts.filter((x) => x === "hello mcp")).toHaveLength(1);

    release();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    // Idle clears the hold; this fake never wrote a Trace, so the message is gone again —
    // which also proves the append came from pendingInputs, not some other channel.
    const after = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    expect(after.messages.map((m) => (m.payload as { text?: string }).text)).not.toContain(
      "hello mcp",
    );
  });
});
