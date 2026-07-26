/**
 * Trace file export/import integration tests:
 * export serves the raw JSONL verbatim as an attachment (any member); import validates the
 * uploaded content (parseable JSONL, leading session_meta, filename-safe session_id), stores
 * it at the session's next free index — never overwriting — and the file is then browsable
 * through the existing tree/detail endpoints. Import is owner-only, mirroring the Agent
 * snapshot import.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OmniMessage, SessionMetaPayload } from "@prismshadow/penguin-core";
import type {
  AgentTracesResponse,
  ProjectCreateResponse,
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
    tools: [],
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
  };
}

/** Envelope with a fixed timestamp (the builders stamp "now"; import derives the date dir from it). */
const rec = (timestamp: string, type: OmniMessage["type"], payload: unknown): OmniMessage =>
  ({ timestamp, type, payload }) as OmniMessage;

function sampleTrace(sessionId: string): OmniMessage[] {
  return [
    rec("2026-07-06T09:00:00.000Z", "session_meta", metaPayload(sessionId)),
    rec("2026-07-06T09:00:01.000Z", "model_msg", {
      type: "text",
      role: "user",
      text: "imported input",
    }),
    rec("2026-07-06T09:00:02.000Z", "event_msg", { type: "request_begin" }),
    rec("2026-07-06T09:00:03.000Z", "event_msg", { type: "request_end", status: "completed" }),
  ];
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

  it("import: stores the file and it becomes browsable through the existing endpoints", async () => {
    const res = await owner.post(`${base()}/import`, {
      dataBase64: b64(toContent(sampleTrace(SID))),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as TraceImportResponse;
    expect(body).toEqual({ sessionId: SID, index: 1, date: "2026-07-06" });
    // Appears in the drill-down tree under the date derived from the first record's timestamp.
    const tree = (await (await owner.get(base())).json()) as AgentTracesResponse;
    expect(tree.dates).toHaveLength(1);
    expect(tree.dates[0]!.date).toBe("2026-07-06");
    expect(tree.dates[0]!.sessions[0]!.sessionId).toBe(SID);
    expect(tree.dates[0]!.sessions[0]!.files.map((f) => f.index)).toEqual([1]);
    // Events are readable via the existing detail endpoint.
    const events = (await (await owner.get(`${base()}/${SID}/1`)).json()) as TraceEventsResponse;
    expect(events.total).toBe(4);
    expect((events.events[1]!.payload as { text: string }).text).toBe("imported input");
  });

  it("import: allocates the next free index and never overwrites existing files", async () => {
    const original = sampleTrace(SID);
    // Existing files across two date dirs: the max index counts across all of them.
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-05", SID, 1, original);
    await writeTraceFile(t.root, projectId, "default_agent", "2026-07-06", SID, 2, original);
    const content = toContent(sampleTrace(SID)).trimEnd(); // uploaded without a trailing newline
    const res = await owner.post(`${base()}/import`, { dataBase64: b64(content) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as TraceImportResponse).index).toBe(3);
    // Stored content is normalized to exactly one trailing newline; existing files are intact.
    expect(await (await owner.get(`${base()}/${SID}/3/download`)).text()).toBe(content + "\n");
    expect(await (await owner.get(`${base()}/${SID}/1/download`)).text()).toBe(toContent(original));
  });

  it("import: malformed middle line → 400 invalid_trace", async () => {
    const lines = toContent(sampleTrace(SID)).split("\n");
    lines[1] = "{not json"; // corrupt a middle line (non-final: parseTraceLines throws loudly)
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
