/** Agents-panel child control routes: parent ownership, message delivery, and interrupt. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BackgroundSubagentInfo } from "@prismshadow/penguin-core";
import type { SessionRow } from "../src/db/repos/sessions.js";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const SID = "session-2026-08-14-01-00-00-aabb0001";
const CHILD = "session-2026-08-14-01-00-01-aabb0002";

describe("subagent controls", () => {
  let t: TestApp;
  let cookie: string;
  let outsiderCookie: string;
  let row: SessionRow;
  let child: BackgroundSubagentInfo;

  beforeEach(async () => {
    t = await createTestApp();
    ({ cookie } = await provisionUser(t.app, "subagent_owner"));
    ({ cookie: outsiderCookie } = await provisionUser(t.app, "subagent_outsider"));
    row = {
      sessionId: SID,
      projectId: "subagent_owner-default_project",
      agentId: "default_agent",
      modelId: "m1",
      provider: "custom",
      workspace: "/tmp/w",
      approvalMode: "allow-all",
      title: null,
      createdAt: new Date().toISOString(),
    };
    child = {
      sessionId: CHILD,
      status: "running",
      startedAt: Date.parse("2026-08-14T01:00:01.000Z"),
      endedAt: null,
    };
    const runtime: RuntimeSession = {
      sessionId: SID,
      toolPermission: () => "rw",
      generateTitle: async () => ({ title: null, usage: null }),
      compactability: () => "ok",
      steer: () => false,
      skipReconnectWait: () => false,
      async *run() {},
      async *compact() {},
      listSubagents: () => [child],
      sendSubagentMessage: (sessionId) => {
        if (sessionId !== CHILD) return "not_found";
        return child.status === "idle" ? "started" : "steered";
      },
      interruptSubagent: (sessionId) => {
        if (sessionId !== CHILD || child.status !== "running") return false;
        child = { ...child, status: "stopping" };
        return true;
      },
    };
    t.deps.sessionsRepo.insert(row);
    t.deps.manager.adopt(row, runtime);
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("delivers a running-child correction", async () => {
    const api = apiClient(t.app, cookie);
    const sent = await api.post(`/api/sessions/${SID}/subagents/${CHILD}/messages`, {
      text: "  correct course  ",
    });
    expect(sent.status).toBe(202);
    expect(await sent.json()).toEqual({ delivery: "steered" });
  });

  it("interrupts idempotently and rejects blank/unknown child messages", async () => {
    const api = apiClient(t.app, cookie);
    const stopped = await api.post(`/api/sessions/${SID}/subagents/${CHILD}/abort`, {});
    expect(stopped.status).toBe(202);
    const again = await api.post(`/api/sessions/${SID}/subagents/${CHILD}/abort`, {});
    expect(again.status).toBe(204);

    const blank = await api.post(`/api/sessions/${SID}/subagents/${CHILD}/messages`, {
      text: "   ",
    });
    expect(blank.status).toBe(400);
    const unknown = await api.post(`/api/sessions/${SID}/subagents/other/messages`, {
      text: "hello",
    });
    expect(unknown.status).toBe(404);
  });

  it("returns the same 404 to a user outside the parent Project", async () => {
    const outsider = apiClient(t.app, outsiderCookie);
    expect(
      (
        await outsider.post(`/api/sessions/${SID}/subagents/${CHILD}/messages`, {
          text: "hello",
        })
      ).status,
    ).toBe(404);
    expect((await outsider.post(`/api/sessions/${SID}/subagents/${CHILD}/abort`, {})).status).toBe(
      404,
    );
  });
});
