/**
 * Every call that names a Session reaches the machine the Session lives on.
 *
 * The routing rule reads `/api/sessions/<id>/…` off the path (lib/session-machines.ts). Two
 * kinds of call escape it and have to carry the machine by hand: an endpoint that buries a
 * Session id in an Agent-level path (the Trace endpoints), and a bare URL used in `<img>`,
 * `<iframe>`, `fetch` or a download link, which never passes through the fetch wrapper. Both
 * failed the same way — asked of this server about a Session on a machine, which truthfully
 * had no such file — and both are pinned here by scanning the source, so the next endpoint of
 * either shape is caught the moment it is written.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { agentTraceDownloadUrl, workspaceFileUrl } from "../src/api/endpoints";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";

const SOURCE = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "api", "endpoints.ts"),
  "utf8",
);

afterEach(() => forgetSessionMachines());

describe("Session ids buried in Agent-level paths", () => {
  it("every /traces/<sessionId> endpoint passes the Session's machine explicitly", () => {
    // Each `export const … =` block that builds a `/traces/${…sessionId…}` path must mention
    // machineForSession: the rule cannot read the id out of that path.
    const blocks = SOURCE.split(/\nexport const /).slice(1);
    const offenders = blocks
      .filter((block) => /\/traces\/\$\{encodeURIComponent\(sessionId\)\}/.test(block))
      .filter((block) => !block.includes("machineForSession(sessionId)"))
      .map((block) => block.split(/[\s=(]/)[0]);
    expect(offenders).toEqual([]);
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
