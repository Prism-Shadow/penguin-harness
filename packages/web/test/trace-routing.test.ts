/**
 * Calls that name a Session without declaring it in the path still reach the machine the
 * Session lives on. The routing rule reads `/api/sessions/<id>/…` (lib/session-machines.ts);
 * the Agent-level Trace endpoints bury the id deeper, and a bare URL for `<img>`, `<iframe>` or
 * a download never passes through the fetch wrapper, so each carries the machine itself.
 *
 * - Reading a Trace's events or its analysis through the Agent-level endpoints goes to the
 *   Session's machine, and to this server for a Session that lives here.
 * - A Workspace file's address follows its Session to the machine.
 * - A Trace download link does too.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  agentTraceDownloadUrl,
  getAgentTraceAnalysis,
  getAgentTraceEvents,
  workspaceFileUrl,
} from "../src/api/endpoints";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { json, stubFetch } from "./helpers/fetch";

afterEach(() => forgetSessionMachines());

describe("Session ids buried in Agent-level paths", () => {
  it("the Agent-level Trace reads go to the machine the Session lives on", async () => {
    const fetch = stubFetch(() => json({}));
    rememberSessionMachine("s1", "M1");
    await getAgentTraceEvents("p", "a", "s1", 3, 0, 50);
    await getAgentTraceAnalysis("p", "a", "s1", 3);
    await getAgentTraceEvents("p", "a", "here", 0, 0, 50);
    expect(fetch.requests.map((r) => [r.machine, r.path])).toEqual([
      ["M1", "/api/projects/p/agents/a/traces/s1/3"],
      ["M1", "/api/projects/p/agents/a/traces/s1/3/analysis"],
      [null, "/api/projects/p/agents/a/traces/here/0"],
    ]);
  });
});

describe("URLs, which no fetch wrapper routes", () => {
  it("a Workspace file's address follows its Session to the machine", () => {
    expect(workspaceFileUrl("s1", "/a b.txt")).toBe(
      "/api/sessions/s1/files/content?path=%2Fa%20b.txt",
    );
    rememberSessionMachine("s1", "M1");
    expect(workspaceFileUrl("s1", "/a b.txt", true)).toBe(
      "/server/M1/api/sessions/s1/files/content?path=%2Fa%20b.txt&download=1",
    );
  });

  it("a Trace download link does too", () => {
    rememberSessionMachine("s2", "M2");
    expect(agentTraceDownloadUrl("p", "a", "s2", 3)).toBe(
      "/server/M2/api/projects/p/agents/a/traces/s2/3/download",
    );
    expect(agentTraceDownloadUrl("p", "a", "elsewhere", 0)).toBe(
      "/api/projects/p/agents/a/traces/elsewhere/0/download",
    );
  });
});
