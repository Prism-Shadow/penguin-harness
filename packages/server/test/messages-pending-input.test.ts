/**
 * GET /messages during the first run's bootstrap window (MCP connect + discovery): the
 * engine writes the input to the Trace only after the bootstrap, and the draft flow
 * subscribes to the stream only after the input publish — so history rebuilds during the
 * connect used to lose the user's own message. The manager now holds the published
 * inputs until the run's FIRST request_begin (by which point the engine has written
 * input + bootstrap records to the Trace) and the messages endpoint appends whichever
 * of them the Trace read has not caught up to (exact-envelope dedup); idle clears the
 * holds as a backstop for runs that never issue a request. Ending the holds at
 * request_begin is what keeps a LONG run from re-serving the input: the endpoint's
 * dedup only scans the history tail, and a hold outliving that window would append the
 * user's message a second time at the end of the conversation.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  mcpConnectBegin,
  mcpConnectEnd,
  requestBegin,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagesResponse } from "../src/api/types.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-10-10-00-00-eeff0002";

/**
 * Fake Session that yields the MCP connect begin (the real Session streams it live before
 * the engine exists), then parks until released — the bootstrap window: nothing has
 * reached the Trace yet (this fake writes no Trace at all). After the first gate it
 * issues the run's first request_begin and parks again, so the test can observe the
 * holds ending mid-run.
 */
function parkedBootstrapSession(
  sessionId: string,
  bootstrapGate: Promise<void>,
  requestGate: Promise<void>,
): RuntimeSession {
  return {
    sessionId,
    toolPermission: () => "rw",
    generateTitle: async () => ({ title: null, usage: null }),
    compactability: () => "ok" as const,
    steer: () => false,
    skipReconnectWait: () => false,
    async *run() {
      yield mcpConnectBegin(["fx"]);
      await bootstrapGate;
      yield requestBegin();
      await requestGate;
      yield assistantText("done");
    },
    async *compact() {},
  };
}

describe("GET /messages serves the running task's pending inputs", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let releaseBootstrap!: () => void;
  let releaseRequest!: () => void;

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
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    t.deps.manager.adopt(row, parkedBootstrapSession(SID, bootstrapGate, requestGate));
  });

  afterEach(async () => {
    releaseBootstrap();
    releaseRequest();
    await t.cleanup();
  });

  it("appends the input during the bootstrap window and ends both holds at the run's first request_begin", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "hello mcp" }],
    });
    expect(res.status).toBe(202);

    // Give the drive loop a beat to pump the fake's begin event into the hold.
    await waitFor(() => t.deps.manager.pendingBootstrap(SID).length === 1);

    // Mid-bootstrap: no Trace exists yet, but the endpoint serves the published input AND
    // the streamed connect status — without the latter, a rebuilding page shows a silent
    // blank while a slow MCP server times out.
    const during = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    const texts = during.messages.map((m) => (m.payload as { text?: string }).text);
    expect(texts).toContain("hello mcp");
    const duringTypes = during.messages.map((m) => (m.payload as { type?: string }).type);
    expect(duringTypes).toContain("mcp_connect_begin");

    // Windowed tail reads carry it the same way.
    const tail = (await (
      await api.get(`/api/sessions/${SID}/messages?tailLimit=10`)
    ).json()) as MessagesResponse;
    expect(tail.messages.map((m) => (m.payload as { text?: string }).text)).toContain("hello mcp");

    // No duplication: the pending input appears exactly once.
    expect(texts.filter((x) => x === "hello mcp")).toHaveLength(1);

    // First request_begin: the engine has written input + bootstrap records to the Trace
    // before issuing any request, so both holds end HERE — while the run is still going.
    // A hold that lived to idle would outgrow the messages endpoint's tail-window dedup
    // on a long Task and re-append the user's message at the end of the conversation.
    releaseBootstrap();
    await waitFor(() => t.deps.manager.pendingInputs(SID).length === 0);
    expect(t.deps.manager.pendingBootstrap(SID)).toHaveLength(0);
    expect(t.deps.manager.statusOf(SID)).not.toBe("idle");
    // This fake never wrote a Trace, so with the holds gone the appended copies vanish —
    // proving the earlier appends came from the holds, not some other channel.
    const mid = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    expect(mid.messages.map((m) => (m.payload as { text?: string }).text)).not.toContain(
      "hello mcp",
    );

    releaseRequest();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
    const after = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    expect(after.messages.map((m) => (m.payload as { text?: string }).text)).not.toContain(
      "hello mcp",
    );
    expect(after.messages.map((m) => (m.payload as { type?: string }).type)).not.toContain(
      "mcp_connect_begin",
    );
  });

  it("keeps the holds after a run aborted mid-bootstrap (no request_begin): a reload still sees the message; the next run appends", async () => {
    const SID2 = "session-2026-08-11-10-00-00-eeff0003";
    const row: SessionRow = {
      sessionId: SID2,
      projectId: "pender-default_project",
      agentId: "default_agent",
      provider: "custom",
      modelId: "m1",
      workspace: "/tmp/w",
      approvalMode: "always-ask",
      title: null,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
    };
    t.deps.sessionsRepo.insert(row);
    // First run: connect aborted before any request (the core cancels the bootstrap and
    // carries the input). Second run: a fresh connect that reaches request_begin.
    let runs = 0;
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    t.deps.manager.adopt(row, {
      sessionId: SID2,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok" as const,
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {
        runs += 1;
        yield mcpConnectBegin(["fx"]);
        if (runs === 1) {
          yield mcpConnectEnd({ status: "aborted", results: [] });
          return;
        }
        // Parked between the connect stream and the first request, so the test can
        // observe the holds while they still exist.
        await connectGate;
        yield requestBegin();
        await secondGate;
        yield assistantText("done");
      },
      async *compact() {},
    });

    const first = await api.post(`/api/sessions/${SID2}/tasks`, {
      input: [{ type: "text", text: "lost?" }],
    });
    expect(first.status).toBe(202);
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");

    // Idle after the aborted bootstrap: nothing reached the Trace, so the held input and
    // the aborted connect pair are the only copy a reload can show — they must survive.
    const afterAbort = (await (await api.get(`/api/sessions/${SID2}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    expect(afterAbort.messages.map((m) => (m.payload as { text?: string }).text)).toContain(
      "lost?",
    );
    const abortTypes = afterAbort.messages.map((m) => (m.payload as { type?: string }).type);
    expect(abortTypes).toContain("mcp_connect_begin");
    expect(abortTypes).toContain("mcp_connect_end");

    // Next send: the new input APPENDS to the held one (both served), while the stale
    // aborted connect pair is dropped — this run streams its own bootstrap.
    const second = await api.post(`/api/sessions/${SID2}/tasks`, {
      input: [{ type: "text", text: "retry" }],
    });
    expect(second.status).toBe(202);
    await waitFor(() => t.deps.manager.pendingBootstrap(SID2).length === 1);
    const during = (await (await api.get(`/api/sessions/${SID2}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    const texts = during.messages.map((m) => (m.payload as { text?: string }).text);
    expect(texts.filter((x) => x === "lost?")).toHaveLength(1);
    expect(texts.filter((x) => x === "retry")).toHaveLength(1);
    expect(
      during.messages.filter((m) => (m.payload as { type?: string }).type === "mcp_connect_begin"),
    ).toHaveLength(1);

    // request_begin ends the holds (the engine has persisted the carried inputs by then).
    releaseConnect();
    await waitFor(() => t.deps.manager.pendingInputs(SID2).length === 0);
    expect(t.deps.manager.pendingBootstrap(SID2)).toHaveLength(0);
    releaseSecond();
    await waitFor(() => t.deps.manager.statusOf(SID2) === "idle");
  });
});
