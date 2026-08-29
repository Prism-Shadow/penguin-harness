/**
 * A call about a Session on a machine reaches that machine even when its path does not say
 * so (api/endpoints.ts).
 *
 * The routing rule is a rule over the PATH: `/api/sessions/<id>/…` goes wherever `<id>` was
 * last seen, everything else stays here (lib/session-machines.ts). That covers the two dozen
 * Session-scoped endpoints and nothing else — so an endpoint that names a Session ANY OTHER
 * WAY is silently asked of this server. The Agent-level Trace endpoints do exactly that, and
 * the failure is a good imitation of a real answer: this server truthfully reports it has no
 * such Trace file, and the panel says the Trace no longer exists while it sits on the machine,
 * intact.
 *
 * The scan at the bottom is the part that matters over time: it fails for the NEXT endpoint
 * added with a Session id buried in its path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  agentTraceDownloadUrl,
  getAgentTraceAnalysis,
  getAgentTraceEvents,
} from "../src/api/endpoints";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";

const REMOTE = "AtZ2EEKC5jxZipMN";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  forgetSessionMachines();
  fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  forgetSessionMachines();
  vi.unstubAllGlobals();
});

const urlOf = () => String(fetchMock.mock.calls[0]![0]);

describe("Agent-level Trace endpoints follow the Session's machine", () => {
  it("asks the machine for the events of a Session that lives there", async () => {
    rememberSessionMachine("s1", REMOTE);
    await getAgentTraceEvents("p1", "a1", "s1", 0, 0, 50);
    expect(urlOf()).toContain(`/server/${REMOTE}/api/projects/p1/agents/a1/traces/s1/0`);
  });

  it("asks the machine for the analysis too", async () => {
    rememberSessionMachine("s1", REMOTE);
    await getAgentTraceAnalysis("p1", "a1", "s1", 0);
    expect(urlOf()).toContain(`/server/${REMOTE}/api/projects/p1/agents/a1/traces/s1/0/analysis`);
  });

  it("builds a download URL the browser can follow to that machine", () => {
    // Nothing to route: the browser follows this itself, so the prefix has to be in the URL.
    rememberSessionMachine("s1", REMOTE);
    expect(agentTraceDownloadUrl("p1", "a1", "s1", 0)).toBe(
      `/server/${REMOTE}/api/projects/p1/agents/a1/traces/s1/0/download`,
    );
  });

  it("stays on this server for a Session that lives here", async () => {
    await getAgentTraceEvents("p1", "a1", "local-session", 0, 0, 50);
    expect(urlOf()).not.toContain("/server/");
    expect(agentTraceDownloadUrl("p1", "a1", "local-session", 0)).toBe(
      "/api/projects/p1/agents/a1/traces/local-session/0/download",
    );
  });
});

describe("no endpoint names a Session in a path the routing rule cannot read", () => {
  it("every such endpoint routes itself explicitly", () => {
    const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/api/endpoints.ts");
    const source = fs.readFileSync(file, "utf8");
    // One chunk per exported endpoint. Approximate, and deliberately so: it is the whole
    // declaration, so an explicit `server:` anywhere in it counts.
    const chunks = source.split(/\nexport const /);
    expect(chunks.length).toBeGreaterThan(50);

    const offenders: string[] = [];
    for (const chunk of chunks) {
      if (!chunk.includes("encodeURIComponent(sessionId)")) continue;
      // Session-scoped: the path declares the Session and the rule routes it.
      if (chunk.includes("/api/sessions/${encodeURIComponent(sessionId)}")) continue;
      if (chunk.includes("machineForSession(sessionId)")) continue;
      offenders.push(chunk.slice(0, chunk.indexOf("(")).trim());
    }
    expect(
      offenders,
      `these embed a Session id in a path the routing rule does not read, and so are asked of ` +
        `this server about a Session that may live elsewhere — pass ` +
        `\`server: machineForSession(sessionId)\`: ${offenders.join(", ")}`,
    ).toEqual([]);
  });
});
