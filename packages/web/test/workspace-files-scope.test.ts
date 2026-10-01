/**
 * Where the Files panel's operations go (api/workspace-files.ts).
 *
 * - A Session's files are asked of the Session, on the machine it lives on.
 * - A directory's files are asked by its path, of the machine it is on, and of this server when
 *   it is on this one — for calls and for the URLs a browser follows alike.
 * - A save hands back the version the server says it wrote.
 * - The same path on two machines is two scopes: the panel never carries one's state to the
 *   other.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filesApi, filesScopeKey } from "../src/api/workspace-files";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";

const MACHINE = "m7Kd0Q2xVbNzR1aP";

describe("Files panel scopes", () => {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  /** The file calls alone: the client may probe the session first. */
  const fileCalls = () => calls.filter((c) => c.url.includes("files"));
  let reply: () => Response;
  beforeEach(() => {
    calls.length = 0;
    reply = () =>
      new Response(JSON.stringify({ path: "src", entries: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    vi.stubGlobal("WebSocket", undefined);
    vi.stubGlobal("fetch", async (url: string, init?: { method?: string; body?: string }) => {
      calls.push({
        url,
        method: init?.method ?? "GET",
        ...(init?.body === undefined ? {} : { body: JSON.parse(init.body) }),
      });
      return reply();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    forgetSessionMachines();
  });

  it("a Session's files are asked of the Session, on the machine it lives on", async () => {
    rememberSessionMachine("session-on-m7", MACHINE);
    const files = filesApi({ kind: "session", sessionId: "session-on-m7" });
    expect(files.fileUrl("notes/a b.md", true)).toBe(
      `/server/${MACHINE}/api/sessions/session-on-m7/files/content?path=notes%2Fa%20b.md&download=1`,
    );
    await files.list("src");
    expect(fileCalls().map((c) => c.url)).toEqual([
      `/server/${MACHINE}/api/sessions/session-on-m7/files?path=src`,
    ]);
  });

  it("a directory's files are asked by its path, of the machine it is on", async () => {
    const remote = filesApi({
      kind: "workspace",
      projectId: "alice-web",
      workspace: "/srv/app",
      machineId: MACHINE,
    });
    expect(remote.fileUrl("a b.txt")).toBe(
      `/server/${MACHINE}/api/projects/alice-web/workspace-files/content?workspace=%2Fsrv%2Fapp&path=a%20b.txt`,
    );
    expect(remote.previewUrl("index.html")).toBe(
      `/server/${MACHINE}/api/projects/alice-web/workspace-files/content?workspace=%2Fsrv%2Fapp&path=index.html&preview=1`,
    );
    expect(remote.isolatablePreviews).toBe(false);
    await remote.create({ path: "src/new", kind: "dir" });

    const local = filesApi({
      kind: "workspace",
      projectId: "alice-web",
      workspace: "/srv/app",
      machineId: null,
    });
    await local.list("src");
    expect(fileCalls()).toEqual([
      {
        url: `/server/${MACHINE}/api/projects/alice-web/workspace-files/create?workspace=%2Fsrv%2Fapp`,
        method: "POST",
        body: { path: "src/new", kind: "dir" },
      },
      {
        url: "/api/projects/alice-web/workspace-files?workspace=%2Fsrv%2Fapp&path=src",
        method: "GET",
      },
    ]);
  });

  it("a save hands back the version the server says it wrote", async () => {
    reply = () => new Response(null, { status: 204, headers: { etag: 'W/"5-1700000000000"' } });
    const files = filesApi({
      kind: "workspace",
      projectId: "alice-web",
      workspace: "/srv/app",
      machineId: null,
    });
    await expect(files.write("a.txt", "aGVsbG8=", 'W/"1-1"')).resolves.toBe('W/"5-1700000000000"');
    expect(fileCalls()[0]?.body).toEqual({ dataBase64: "aGVsbG8=", ifVersion: 'W/"1-1"' });

    reply = () => new Response(null, { status: 204 });
    await expect(files.write("a.txt", "aGVsbG8=")).resolves.toBeNull();
  });

  it("the same path on two machines is two scopes", () => {
    const here = {
      kind: "workspace",
      projectId: "p",
      workspace: "/srv/app",
      machineId: null,
    } as const;
    const there = { ...here, machineId: MACHINE };
    expect(filesScopeKey(here)).toBe(filesScopeKey({ ...here }));
    expect(filesScopeKey(here)).not.toBe(filesScopeKey(there));
    expect(filesScopeKey({ kind: "session", sessionId: "/srv/app" })).not.toBe(filesScopeKey(here));
  });
});
