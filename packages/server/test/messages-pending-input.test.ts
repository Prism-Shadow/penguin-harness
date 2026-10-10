/**
 * GET /messages during the first run's bootstrap window (MCP connect and discovery). The engine
 * writes the input to the Trace only after the bootstrap, and a draft subscribes to the stream
 * only after the input is published, so a history rebuild during the connect used to lose the
 * user's own message. The manager holds the published inputs until the run's FIRST
 * request_begin, and the endpoint appends whichever of them the Trace has not caught up to.
 *
 * - Given a run in its bootstrap window, the endpoint serves the input and the connect status
 *   (full and tail reads alike) exactly once, and both holds end at the first request_begin,
 *   while the run is still going — a hold outliving the tail window would re-append the input.
 * - An input already persisted with a Trace position is not served twice.
 * - A held image whose Trace copy has landed is served once on a windowed page, by reference:
 *   the dedup compares the inline copies, and only then is the Trace copy's image referenced.
 * - A run aborted mid-bootstrap keeps its holds, so a reload still sees the message; the next
 *   run appends its own input and drops the stale connect pair.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  assistantText,
  mcpConnectBegin,
  mcpConnectEnd,
  requestBegin,
  sessionMeta,
} from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagesResponse } from "../src/api/types.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "pender-default_project";

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
  return fakeSession(sessionId, {
    async *run() {
      yield mcpConnectBegin(["fx"]);
      await bootstrapGate;
      yield requestBegin();
      await requestGate;
      yield assistantText("done");
    },
  });
}

describe("GET /messages serves the running task's pending inputs", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let SID: string;
  let releaseBootstrap!: () => void;
  let releaseRequest!: () => void;

  beforeAll(async () => {
    t = await createTestApp();
    api = apiClient(t.app, (await provisionUser(t.app, "pender")).cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });
  beforeEach(() => {
    SID = uniqueSessionId();
    const bootstrapGate = new Promise<void>((resolve) => {
      releaseBootstrap = resolve;
    });
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve;
    });
    adoptSession(t.deps, parkedBootstrapSession(SID, bootstrapGate, requestGate), {
      projectId: PROJECT,
      approvalMode: "always-ask",
    });
  });
  afterEach(() => {
    releaseBootstrap();
    releaseRequest();
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

  it("deduplicates a persisted pending input even when history adds a Trace position", async () => {
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [{ type: "text", text: "positioned once" }],
    });
    expect(res.status).toBe(202);
    await waitFor(() => t.deps.manager.pendingBootstrap(SID).length === 1);
    const input = t.deps.manager.pendingInputs(SID)[0]!;
    await writeTraceFile(t.root, PROJECT, "default_agent", "2026-08-15", SID, 1, [
      sessionMeta({
        session_id: SID,
        provider: "custom",
        model_id: "m1",
        model_context_window: 10_000,
        system_prompt: "test",
        agent_state: "/tmp/agent-state",
        workspace: "/tmp/w",
        source: "user",
      }),
      input,
    ]);

    const during = (await (await api.get(`/api/sessions/${SID}/messages`)).json()) as {
      messages: OmniMessage[];
    };
    expect(
      during.messages.filter(
        (message) => (message.payload as { text?: string }).text === "positioned once",
      ),
    ).toHaveLength(1);

    releaseBootstrap();
    await waitFor(() => t.deps.manager.pendingInputs(SID).length === 0);
    releaseRequest();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("serves a held image whose Trace copy has landed once, by reference", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const res = await api.post(`/api/sessions/${SID}/tasks`, {
      input: [
        { type: "text", text: "see this" },
        { type: "image_url", imageUrl: png },
      ],
    });
    expect(res.status).toBe(202);
    await waitFor(() => t.deps.manager.pendingBootstrap(SID).length === 1);
    await writeTraceFile(t.root, PROJECT, "default_agent", "2026-08-15", SID, 1, [
      sessionMeta({
        session_id: SID,
        provider: "custom",
        model_id: "m1",
        model_context_window: 10_000,
        system_prompt: "test",
        agent_state: "/tmp/agent-state",
        workspace: "/tmp/w",
        source: "user",
      }),
      ...t.deps.manager.pendingInputs(SID),
    ]);

    const tail = (await (
      await api.get(`/api/sessions/${SID}/messages?tailLimit=10`)
    ).json()) as MessagesResponse;
    const images = tail.messages.filter(
      (m) => (m.payload as { type?: string }).type === "image_url",
    );
    expect(images.map((m) => (m.payload as { image_url: string }).image_url)).toEqual([
      `/api/sessions/${SID}/trace-image?file=1&ordinal=2`,
    ]);

    releaseBootstrap();
    await waitFor(() => t.deps.manager.pendingInputs(SID).length === 0);
    releaseRequest();
    await waitFor(() => t.deps.manager.statusOf(SID) === "idle");
  });

  it("keeps the holds after a run aborted mid-bootstrap (no request_begin): a reload still sees the message; the next run appends", async () => {
    const SID2 = uniqueSessionId();
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
    const session = fakeSession(SID2, {
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
    });
    adoptSession(t.deps, session, { projectId: PROJECT, approvalMode: "always-ask" });

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
