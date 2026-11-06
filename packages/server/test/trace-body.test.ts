/**
 * `GET /api/sessions/:id/trace-body?ref=` — one folded value, whole — and who may read it.
 *
 * A ref is the client's to send back, so it authorises nothing by itself: its Agent and
 * Session must be ids, and its Session the path's Session or one of that Session's descendants.
 *
 * - Given a ref into the Session's own line, or into a subagent child it expanded, the value
 *   streams whole.
 * - Given an outsider's ref whose Agent id climbs out of their own Project into another one's
 *   Trace, the answer is 404 and leaks nothing; no index row is written under that id and no
 *   reconcile is remembered for it.
 * - Given a ref into another Session of the same Project, one the path's Session never spawned,
 *   the answer is 404.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assistantText,
  sessionMeta,
  subagentEvent,
  toolCallOutput,
  userText,
} from "@prismshadow/penguin-core";
import type { AmspRecord } from "@prismshadow/penguin-core";
import { encodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import type { HistoryRecords, ProjectCreateResponse } from "../src/api/types.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT = "default_agent";
const DATE = "2026-09-01";

const meta = (sid: string): AmspRecord =>
  sessionMeta({
    session_id: sid,
    provider: "custom",
    model_id: "m1",
    model_context_window: 10_000,
    system_prompt: "sp",
    agent_state: "/tmp/a",
    workspace: "/tmp/w",
    source: "user",
  });

/** The whole value a trace-body stream carried, joined from its parts. */
function valueOf(sse: string): string {
  return sse
    .split("\n\n")
    .filter((b) => b.includes("event: part"))
    .map((b) => {
      const data = b
        .split("\n")
        .find((l) => l.startsWith("data: "))!
        .slice(6);
      return (JSON.parse(data) as HistoryRecords).text;
    })
    .join("");
}

describe("trace-body", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let ownerProject: string;
  let outsiderProject: string;
  const own = uniqueSessionId();
  const child = uniqueSessionId();
  const stranger = uniqueSessionId();
  const secret = uniqueSessionId();
  const longOutput = "v".repeat(40_000);

  beforeAll(async () => {
    t = await createTestApp();
    owner = apiClient(t.app, (await provisionUser(t.app, "owner")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "outsider")).cookie);
    const project = async (c: ReturnType<typeof apiClient>, id: string) =>
      (
        (await (
          await c.post("/api/projects", { projectId: id, name: id })
        ).json()) as ProjectCreateResponse
      ).project.projectId;
    ownerProject = await project(owner, "owner-secret");
    outsiderProject = await project(outsider, "outsider-own");
    // The owner's secret, in a Session the outsider cannot see.
    await writeTraceFile(t.root, ownerProject, AGENT, DATE, secret, 1, [
      meta(secret),
      userText("q"),
      toolCallOutput({
        output: "AWS_SECRET_ACCESS_KEY=owner-only",
        toolCallId: "t",
        status: "completed",
      }),
    ]);
    // The outsider's own Session, which spawned `child`, and a Session it never spawned.
    t.deps.sessionsRepo.insert(sessionRow(own, { projectId: outsiderProject, agentId: AGENT }));
    await writeTraceFile(t.root, outsiderProject, AGENT, DATE, own, 1, [
      meta(own),
      userText("q"),
      toolCallOutput({ output: longOutput, toolCallId: "t1", status: "completed" }),
      subagentEvent(child),
      assistantText("a"),
    ]);
    await writeTraceFile(t.root, outsiderProject, AGENT, DATE, child, 1, [
      meta(child),
      toolCallOutput({ output: `child ${longOutput}`, toolCallId: "c1", status: "completed" }),
    ]);
    await writeTraceFile(t.root, outsiderProject, AGENT, DATE, stranger, 1, [
      meta(stranger),
      toolCallOutput({
        output: "not yours to reach from here",
        toolCallId: "s1",
        status: "completed",
      }),
    ]);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const body = (session: string, ref: string) =>
    outsider.get(`/api/sessions/${session}/trace-body?ref=${ref}`);

  it("streams a value of the Session's own line, and of a child it expanded", async () => {
    const mine = await body(
      own,
      encodeBodyRef({ agentId: AGENT, sessionId: own, fileIndex: 1, ordinal: 2 }, "payload.output"),
    );
    expect(mine.status).toBe(200);
    expect(valueOf(await mine.text())).toBe(longOutput);
    const theirs = await body(
      own,
      encodeBodyRef(
        { agentId: AGENT, sessionId: child, fileIndex: 1, ordinal: 1 },
        "payload.output",
      ),
    );
    expect(theirs.status).toBe(200);
    expect(valueOf(await theirs.text())).toBe(`child ${longOutput}`);
  });

  it("an outsider's ref that climbs into another Project is a 404 that indexes nothing", async () => {
    const traversal = `../../${ownerProject}/agents/${AGENT}`;
    const index = t.deps.traceIndex as unknown as {
      seen: Map<string, unknown>;
      repo: { listFilesByAgent(p: string, a: string): unknown[] };
    };
    // What a request may leave behind is part of the answer: an index row, or a reconcile gate
    // remembered under an id the caller chose.
    const seenBefore = [...index.seen.keys()];
    const res = await body(
      own,
      encodeBodyRef(
        { agentId: traversal, sessionId: secret, fileIndex: 1, ordinal: 2 },
        "payload.output",
      ),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("owner-only");
    expect(index.repo.listFilesByAgent(outsiderProject, traversal)).toEqual([]);
    expect(
      [...index.seen.keys()].filter((k) => !seenBefore.includes(k) && k.includes("..")),
    ).toEqual([]);
    // The route a Trace is otherwise read through refuses the outsider too.
    const direct = await outsider.get(
      `/api/projects/${ownerProject}/agents/${AGENT}/traces/${secret}/1`,
    );
    expect(direct.status).toBe(404);
  });

  it("a ref into a Session the path's Session never spawned is a 404", async () => {
    const res = await body(
      own,
      encodeBodyRef(
        { agentId: AGENT, sessionId: stranger, fileIndex: 1, ordinal: 1 },
        "payload.output",
      ),
    );
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("not yours");
  });
});
