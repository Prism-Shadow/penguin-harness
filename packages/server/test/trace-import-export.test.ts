/**
 * Trace file export/import integration tests:
 * export serves the raw JSONL verbatim as an attachment (any member); import validates the
 * uploaded content (parseable JSONL, leading session_meta, filename-safe session_id) and
 * always stores it as index 1 of a new Session — a session id that exists ANYWHERE in the
 * install is rejected with 409 trace_session_exists — the imported file becomes a listed
 * Session of the receiving Agent, and is browsable through the existing tree/detail
 * endpoints. Import is owner-only, mirroring the Agent snapshot import.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  ProjectCreateResponse,
  SessionsResponse,
  TraceEventsResponse,
  TraceImportResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-07-06-09-00-00-feed0001";

function metaPayload(sessionId: string): SessionMetaPayload {
  return {
    session_id: sessionId,
    model_id: "m",
    provider: "custom",
    model_context_window: 1000,
    system_prompt: "",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
  };
}

/** Envelope with a fixed timestamp (the builders stamp "now"; import derives the date dir from it). */
const rec = (timestamp: string, type: OmniMessage["type"], payload: unknown): OmniMessage =>
  ({ timestamp, type, payload }) as OmniMessage;

/** First record's timestamp: 02:00 UTC, so on runners west of UTC the local date differs from the UTC date. */
const FIRST_TS = "2026-07-06T02:00:00.000Z";

function sampleTrace(sessionId: string): OmniMessage[] {
  return [
    rec(FIRST_TS, "session_meta", metaPayload(sessionId)),
    rec("2026-07-06T02:00:01.000Z", "model_msg", {
      type: "text",
      role: "user",
      text: "imported input",
    }),
    rec("2026-07-06T02:00:02.000Z", "event_msg", { type: "request_begin" }),
    rec("2026-07-06T02:00:03.000Z", "event_msg", { type: "request_end", status: "completed" }),
  ];
}

/**
 * Local yyyy-mm-dd of a timestamp — the import derives its date dir with local-date
 * formatting (core Trace Writer convention), not UTC. Computing the expectation the same
 * way keeps these tests timezone-independent, and on a non-UTC runner they fail if the
 * import regresses to UTC (FIRST_TS is chosen so the two dates differ west of UTC).
 */
function localDateOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const toContent = (messages: OmniMessage[]): string =>
  messages.map((m) => JSON.stringify(m)).join("\n") + "\n";
const b64 = (s: string): string => Buffer.from(s, "utf8").toString("base64");

async function errorCode(res: Response): Promise<string> {
  const body = (await res.json()) as { error: { code: string } };
  return body.error.code;
}

describe("trace-import-export", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  const base = () => `/api/projects/${projectId}/agents/default_agent/traces`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner-trace_io", name: "Trace IO" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("export: serves the raw file with attachment headers (any member)", async () => {
    const messages = sampleTrace(SID);
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-06", SID, 1, messages);
    const res = await owner.get(`${base()}/${SID}/1/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/x-ndjson");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename*=UTF-8''${SID}_001.jsonl`,
    );
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe(toContent(messages));
    // A plain member can export too (same rule as the snapshot export).
    expect((await member.get(`${base()}/${SID}/1/download`)).status).toBe(200);
  });

  it("export: unknown index → 404 trace_not_found; outsider → 404", async () => {
    await writeTraceFile(
      t.root,
      projectId,
      "default_agent",
      "2026-07-06",
      SID,
      1,
      sampleTrace(SID),
    );
    const missing = await owner.get(`${base()}/${SID}/9/download`);
    expect(missing.status).toBe(404);
    expect(await errorCode(missing)).toBe("trace_not_found");
    // No Project access → uniform 404 (requireProjectAccess does not leak existence).
    expect((await outsider.get(`${base()}/${SID}/1/download`)).status).toBe(404);
  });

  it("import: stores the file as index 1 and it becomes browsable through the existing endpoints", async () => {
    const content = toContent(sampleTrace(SID)).trimEnd(); // uploaded without a trailing newline
    const res = await owner.post(`${base()}/import`, { dataBase64: b64(content) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TraceImportResponse;
    expect(body).toEqual({ sessionId: SID, index: 1, date: localDateOf(FIRST_TS) });
    // Appears in the drill-down tree under the local date derived from the first record's timestamp.
    const tree = (await (await owner.get(base())).json()) as AgentTracesResponse;
    expect(tree.dates).toHaveLength(1);
    expect(tree.dates[0]!.date).toBe(localDateOf(FIRST_TS));
    expect(tree.dates[0]!.sessions[0]!.sessionId).toBe(SID);
    expect(tree.dates[0]!.sessions[0]!.files.map((f) => f.index)).toEqual([1]);
    // Events are readable via the existing detail endpoint.
    const events = (await (await owner.get(`${base()}/${SID}/1`)).json()) as TraceEventsResponse;
    expect(events.total).toBe(4);
    expect((events.events[1]!.payload as { text: string }).text).toBe("imported input");
    // Round-trip: the stored content is normalized to exactly one trailing newline.
    expect(await (await owner.get(`${base()}/${SID}/1/download`)).text()).toBe(content + "\n");
  });

  it("import: duplicate session id → 409 trace_session_exists, nothing written", async () => {
    const original = sampleTrace(SID);
    // An existing file in any date dir counts — even a different date than the upload's.
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-05", SID, 1, original);
    const res = await owner.post(`${base()}/import`, {
      dataBase64: b64(toContent(sampleTrace(SID))),
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("trace_session_exists");
    // Nothing was written: the tree still shows only the pre-existing file, intact.
    const tree = (await (await owner.get(base())).json()) as AgentTracesResponse;
    expect(tree.dates).toHaveLength(1);
    expect(tree.dates[0]!.date).toBe("2026-07-05");
    expect(tree.dates[0]!.sessions[0]!.files.map((f) => f.index)).toEqual([1]);
    expect(await (await owner.get(`${base()}/${SID}/1/download`)).text()).toBe(toContent(original));
  });

  it("import: the file becomes a Session of the receiving Agent, listed without the CLI filter", async () => {
    // An imported Trace IS a conversation of this install, not a foreign artefact: it has to
    // appear in the conversation list, which is served from the sessions table. Registering
    // only the Trace file left it visible solely under "show CLI sessions" — the filter for
    // Sessions this server never created.
    expect(
      (await owner.post(`${base()}/import`, { dataBase64: b64(toContent(sampleTrace(SID))) }))
        .status,
    ).toBe(200);
    const listed = (await (
      await owner.get(`/api/projects/${projectId}/agents/default_agent/sessions?counts=1`)
    ).json()) as SessionsResponse;
    expect(listed.sessions.map((x) => x.sessionId)).toEqual([SID]);
    expect(listed.counts?.active).toBe(1);
    // Carried over from the file's own session_meta, so the row is a usable conversation
    // rather than a stub: model reference, Workspace, and the Trace it was imported from.
    const row = listed.sessions[0]!;
    expect(row.provider).toBe("custom");
    expect(row.modelId).toBe("m");
    expect(row.workspace).toBe("/tmp/w");
    expect(row.hasTrace).toBe(true);
    // Its Workspace group knows it too — the per-Workspace share the sidebar counts a group by.
    expect(listed.workspaceCounts?.["/tmp/w"]?.active).toBe(1);
  });

  it("import: a session id that exists anywhere in the install → 409, whichever Agent holds it", async () => {
    // A session id is the identity everywhere: the sessions table keys on it, the frontend
    // dedupes rows by it. Importing the same Trace under a SECOND Agent used to pass the
    // per-Agent check and produce a Session nothing could own — no row could sit beside the
    // existing one, so a group's count stood one above the rows it could ever show.
    expect(
      (await owner.post(`${base()}/import`, { dataBase64: b64(toContent(sampleTrace(SID))) }))
        .status,
    ).toBe(200);
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "second", name: "Second" }))
        .status,
    ).toBe(201);
    const res = await owner.post(`/api/projects/${projectId}/agents/second/traces/import`, {
      dataBase64: b64(toContent(sampleTrace(SID))),
    });
    expect(res.status).toBe(409);
    expect(await errorCode(res)).toBe("trace_session_exists");
    // Nothing was written for the second Agent.
    const tree = (await (
      await owner.get(`/api/projects/${projectId}/agents/second/traces`)
    ).json()) as AgentTracesResponse;
    expect(tree.dates).toEqual([]);
  });

  it("import: concurrent imports of the same new session id — exactly one wins", async () => {
    // Whichever request loses is rejected either by the pre-check (locateAll) or by the
    // exclusive `wx` write (EEXIST → the same 409), so the observable outcome is
    // deterministic even though the internal interleaving isn't: one 200, one 409, and
    // exactly one stored file.
    const content = toContent(sampleTrace(SID));
    const [a, b] = await Promise.all([
      owner.post(`${base()}/import`, { dataBase64: b64(content) }),
      owner.post(`${base()}/import`, { dataBase64: b64(content) }),
    ]);
    expect([a.status, b.status].sort((x, y) => x - y)).toEqual([200, 409]);
    expect(await errorCode(a.status === 409 ? a : b)).toBe("trace_session_exists");
    const tree = (await (await owner.get(base())).json()) as AgentTracesResponse;
    expect(tree.dates).toHaveLength(1);
    expect(tree.dates[0]!.sessions[0]!.files.map((f) => f.index)).toEqual([1]);
  });

  it("import: malformed middle line → 400 invalid_trace", async () => {
    const lines = toContent(sampleTrace(SID)).split("\n");
    // Corrupt a middle (non-final) line. Read paths skip malformed middle lines (#215
    // recovery), but import validates strictly (onMalformed: "throw") — damage in an
    // uploaded file is reported, not silently dropped.
    lines[1] = "{not json";
    const res = await owner.post(`${base()}/import`, { dataBase64: b64(lines.join("\n")) });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_trace");
  });

  it("import: first record not session_meta → 400 invalid_trace", async () => {
    const content = toContent([
      rec("2026-07-06T09:00:00.000Z", "model_msg", { type: "text", role: "user", text: "x" }),
    ]);
    const res = await owner.post(`${base()}/import`, { dataBase64: b64(content) });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_trace");
  });

  it("import: session_meta with a filename-unsafe session_id → 400 invalid_trace", async () => {
    const content = toContent([
      rec("2026-07-06T09:00:00.000Z", "session_meta", metaPayload("../../escape")),
    ]);
    const res = await owner.post(`${base()}/import`, { dataBase64: b64(content) });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe("invalid_trace");
  });

  it("import: payload over 14MB → 400 (same cap style as the snapshot import)", async () => {
    const res = await owner.post(`${base()}/import`, {
      dataBase64: b64("a".repeat(14 * 1024 * 1024 + 1)),
    });
    expect(res.status).toBe(400);
  });

  it("import: owner only — member 403, outsider 404, unknown agent 404", async () => {
    const body = { dataBase64: b64(toContent(sampleTrace(SID))) };
    expect((await member.post(`${base()}/import`, body)).status).toBe(403);
    expect((await outsider.post(`${base()}/import`, body)).status).toBe(404);
    expect(
      (await owner.post(`/api/projects/${projectId}/agents/ghost/traces/import`, body)).status,
    ).toBe(404);
  });
});
