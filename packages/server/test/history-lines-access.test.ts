/**
 * Who is refused the history routes, and how (http/routes/history-lines.ts). A hub reads its
 * machines as their admin, and drops its copy of a Session the machine says does not exist, so a
 * refusal must not read as a deletion.
 *
 * - Given an admin without access to a Session (the identity a hub reads a machine as), the
 *   machine leg — window and fill alike — and `trace-body` answer 403 `session_forbidden`.
 * - Given an ordinary user without access, they answer 404 `session_not_found`: a Session's
 *   existence is not revealed to someone who may not read it.
 * - Given a Session that does not exist, an admin is answered 404 `session_not_found`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionMeta, toolCallOutput, userText } from "@prismshadow/penguin-core";
import { encodeBodyRef } from "@prismshadow/penguin-core/interfaces";
import type { ProjectCreateResponse } from "../src/api/types.js";
import { sessionRow, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, writeTraceFile } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT = "default_agent";

describe("refusals on the history routes", () => {
  let t: TestApp;
  let admin: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  const sid = uniqueSessionId();
  let ref: string;

  beforeAll(async () => {
    t = await createTestApp();
    admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const owner = apiClient(t.app, (await provisionUser(t.app, "keeper")).cookie);
    outsider = apiClient(t.app, (await provisionUser(t.app, "stranger")).cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "keeper-hist", name: "keeper-hist" })
    ).json()) as ProjectCreateResponse;
    const project = created.project.projectId;
    t.deps.sessionsRepo.insert(sessionRow(sid, { projectId: project, agentId: AGENT }));
    await writeTraceFile(t.root, project, AGENT, "2026-09-01", sid, 1, [
      sessionMeta({
        session_id: sid,
        provider: "custom",
        model_id: "m1",
        model_context_window: 10_000,
        system_prompt: "sp",
        agent_state: "/tmp/a",
        workspace: "/tmp/w",
        source: "user",
      }),
      userText("q"),
      toolCallOutput({ output: "o".repeat(40_000), toolCallId: "t", status: "completed" }),
    ]);
    ref = encodeBodyRef(
      { agentId: AGENT, sessionId: sid, fileIndex: 1, ordinal: 2 },
      "payload.output",
    );
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const codeOf = async (res: Response) =>
    ((await res.json()) as { error: { code: string } }).error.code;

  it("an admin without access is refused with 403 session_forbidden, window, fill and body alike", async () => {
    for (const path of [
      `/api/sessions/${sid}/history-lines?tailLimit=1`,
      `/api/sessions/${sid}/history-lines?fill=only`,
      `/api/sessions/${sid}/trace-body?ref=${ref}`,
    ]) {
      const res = await admin.get(path);
      expect(res.status).toBe(403);
      expect(await codeOf(res)).toBe("session_forbidden");
    }
  });

  it("an ordinary user without access is told 404, the Session's existence unrevealed", async () => {
    const res = await outsider.get(`/api/sessions/${sid}/history-lines?tailLimit=1`);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("session_not_found");
  });

  it("a Session that does not exist is 404 session_not_found, to an admin too", async () => {
    const res = await admin.get(`/api/sessions/${uniqueSessionId()}/history-lines?tailLimit=1`);
    expect(res.status).toBe(404);
    expect(await codeOf(res)).toBe("session_not_found");
  });
});
