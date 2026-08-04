/**
 * Agent-level Trace detail endpoint integration tests (FD-3):
 * The Trace page directory tree comes from an Agent-level scan (including unmanaged
 * subagent child Sessions / Sessions created by the CLI), but the Session-level detail
 * endpoint looks up the sessions table, so unmanaged ones return 404 directly. The new
 * Agent-level detail endpoint locates the Trace file directly by
 * (projectId, agentId, sessionId), with access controlled via requireProjectAccess.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requestBegin, requestEnd, sessionMeta, userText } from "@prismshadow/penguin-core";
import type { SessionMetaPayload } from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  ProjectCreateResponse,
  TraceAnalysisResponse,
  TraceEventsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** An unmanaged child Session (only written to Trace, not inserted into the sessions table). */
const UNMANAGED = "session-2026-07-06-09-00-00-cafe0001";

function metaPayload(): SessionMetaPayload {
  return {
    session_id: UNMANAGED,
    model_id: "sub-model",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    tools: [],
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
  };
}

describe("agent-trace-detail", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = () => `/api/projects/${projectId}/agents/default_agent/traces`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    outsider = apiClient(t.app, b.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-trace", name: "Project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-06", UNMANAGED, 1, [
      sessionMeta(metaPayload()),
      userText("child session input"),
      requestBegin(),
      requestEnd("completed"),
    ]);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("unmanaged Session: 404 via the Session-level endpoint, readable at Agent level", async () => {
    // Session-level: no such row in the sessions table -> 404.
    expect((await owner.get(`/api/sessions/${UNMANAGED}/traces/1`)).status).toBe(404);
    // Agent-level detail: locates the Trace file directly -> 200.
    const res = await owner.get(`${base()}/${UNMANAGED}/1`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TraceEventsResponse;
    expect(body.total).toBe(4);
    expect((body.events[1]!.payload as { text: string }).text).toBe("child session input");
  });

  it("Agent-level detail pagination params take effect", async () => {
    const res = await owner.get(`${base()}/${UNMANAGED}/1?offset=1&limit=2`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TraceEventsResponse;
    expect(body.offset).toBe(1);
    expect(body.limit).toBe(2);
    expect(body.events).toHaveLength(2);
    // Invalid index / limit -> 400.
    expect((await owner.get(`${base()}/${UNMANAGED}/0`)).status).toBe(400);
    expect((await owner.get(`${base()}/${UNMANAGED}/1?limit=5000`)).status).toBe(400);
  });

  it("Agent-level analysis endpoint derives Request pairings", async () => {
    const res = await owner.get(`${base()}/${UNMANAGED}/1/analysis`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as TraceAnalysisResponse;
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]!.status).toBe("completed");
  });

  it("nonexistent index → 404 trace_not_found", async () => {
    expect((await owner.get(`${base()}/${UNMANAGED}/9`)).status).toBe(404);
  });

  it("listing without limit keeps the legacy full shape; with limit it pages Session groups and resolves titles", async () => {
    // Legacy request: full date drill-down, no paging fields.
    const legacy = (await (await owner.get(base())).json()) as AgentTracesResponse;
    expect(legacy.dates.map((d) => d.date)).toEqual(["2026-07-06"]);
    expect(legacy.sessions).toBeUndefined();
    expect(legacy.totalSessions).toBeUndefined();

    // Paged request: the unmanaged Session has no sessions-table row, so its title
    // derives from the first user prompt (bounded head-read of the earliest shard).
    const paged = (await (await owner.get(`${base()}?limit=10`)).json()) as AgentTracesResponse;
    expect(paged.totalSessions).toBe(1);
    expect(paged.sessions!.map((s) => s.sessionId)).toEqual([UNMANAGED]);
    expect(paged.sessions![0]!.title).toBe("child session input");
    expect(paged.sessions![0]!.files.map((f) => ({ index: f.index, date: f.date }))).toEqual([
      { index: 1, date: "2026-07-06" },
    ]);

    // A sessions-table title (one batched lookup for the page) wins over the fallback.
    t.deps.sessionsRepo.insert({
      sessionId: UNMANAGED,
      projectId,
      agentId: "default_agent",
      provider: "custom",
      modelId: "sub-model",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: "已生成的标题",
      client: "cli",
      createdAt: "2026-07-06T09:00:00.000Z",
    });
    const titled = (await (await owner.get(`${base()}?limit=10`)).json()) as AgentTracesResponse;
    expect(titled.sessions![0]!.title).toBe("已生成的标题");

    // offset pages past the only group; offset without limit is a client error.
    const empty = (await (
      await owner.get(`${base()}?limit=10&offset=10`)
    ).json()) as AgentTracesResponse;
    expect(empty.sessions).toEqual([]);
    expect(empty.totalSessions).toBe(1);
    expect((await owner.get(`${base()}?offset=1`)).status).toBe(400);
  });

  it("user without access → 404 (requireProjectAccess)", async () => {
    expect((await outsider.get(`${base()}/${UNMANAGED}/1`)).status).toBe(404);
    expect((await outsider.get(`${base()}/${UNMANAGED}/1/analysis`)).status).toBe(404);
  });
});
