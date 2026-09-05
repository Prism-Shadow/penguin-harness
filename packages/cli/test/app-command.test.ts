/**
 * `penguin app` against the fake server: register binds the app to the calling Session
 * (PENGUIN_SESSION_ID) unless --session-id says otherwise and refuses without either,
 * an explicit --id that exists is updated in place, ls renders the table (invalid files
 * marked) or raw JSON, status re-probes one app, and unregister deletes without prompting.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");
const CALLER = "session-2026-09-02-10-00-00-ca11e001";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  stderr = [];
  outSpy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  errSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });
});
afterEach(() => {
  outSpy.mockRestore();
  errSpy.mockRestore();
  uninstall();
});

const out = () => stdout.join("");

describe("penguin app register", () => {
  it("posts the registration bound to the calling Session, kind web by default, and prints the id", async () => {
    process.env.PENGUIN_SESSION_ID = CALLER;
    const code = await cli([
      "app",
      "register",
      "--name",
      "Todo App",
      "--url",
      "http://localhost:3000",
      "--start-command",
      "npm start",
      "--stop-command",
      "npm stop",
    ]);
    expect(code).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/apps"));
    expect(create?.path).toBe("/api/projects/default_project/apps");
    expect(create?.body).toEqual({
      name: "Todo App",
      sessionId: CALLER,
      url: "http://localhost:3000",
      startCommand: "npm start",
      stopCommand: "npm stop",
    });
    expect(out()).toContain("todo app");
    expect(out()).toContain("http://localhost:3000");
  });

  it("--session-id and --kind win over the defaults; an unknown kind is refused before any request", async () => {
    process.env.PENGUIN_SESSION_ID = CALLER;
    expect(
      await cli([
        "app",
        "register",
        "--name",
        "api",
        "--session-id",
        "session-other",
        "--kind",
        "API",
      ]),
    ).toBe(0);
    const create = server.requests.find((r) => r.method === "POST" && r.path.endsWith("/apps"));
    expect(create?.body).toMatchObject({ sessionId: "session-other", kind: "api" });

    server.requests.length = 0;
    expect(await cli(["app", "register", "--name", "x", "--kind", "desktop"])).toBe(1);
    expect(stderr.join("")).toContain("desktop");
    expect(server.requests).toHaveLength(0);
  });

  it("refuses without a Session (no flag, no PENGUIN_SESSION_ID), pointing at --session-id", async () => {
    expect(await cli(["app", "register", "--name", "x"])).toBe(1);
    expect(stderr.join("")).toContain("--session-id");
    expect(server.requests).toHaveLength(0);
  });

  it("an explicit --id that already exists is updated in place (POST 409 → PUT)", async () => {
    process.env.PENGUIN_SESSION_ID = CALLER;
    expect(
      await cli([
        "app",
        "register",
        "--name",
        "Todo",
        "--id",
        "todo",
        "--url",
        "http://localhost:3000",
      ]),
    ).toBe(0);
    stdout.length = 0;
    expect(
      await cli([
        "app",
        "register",
        "--name",
        "Todo",
        "--id",
        "todo",
        "--url",
        "http://localhost:3001",
      ]),
    ).toBe(0);
    const methods = server.requests.filter((r) => r.path.includes("/apps")).map((r) => r.method);
    expect(methods).toEqual(["POST", "POST", "PUT"]);
    expect(server.appItems.get("todo")).toMatchObject({ url: "http://localhost:3001" });
    expect(out()).toContain(t.app.updated("todo", "Todo", "http://localhost:3001"));
  });
});

describe("penguin app ls / status / unregister", () => {
  it("ls renders id, name, kind, status, url and the owning session; invalid files are marked; --json is raw", async () => {
    server.appItems.set("todo", {
      id: "todo",
      name: "Todo",
      sessionId: CALLER,
      sessionExists: true,
      agentId: "default_agent",
      workspace: "/ws",
      url: "http://localhost:3000",
      kind: "web",
      registeredAt: "2026-09-02T10:00:00.000Z",
      updatedAt: "2026-09-02T10:00:00.000Z",
      status: "stopped",
    });
    server.appInvalidFiles = [{ id: "broken", error: "bad toml" }];
    expect(await cli(["app", "ls"])).toBe(0);
    expect(out()).toContain("todo");
    expect(out()).toContain("stopped");
    expect(out()).toContain("http://localhost:3000");
    expect(out()).toContain("ca11e001");
    expect(out()).toContain("broken");
    expect(out()).toContain("invalid");

    stdout.length = 0;
    expect(await cli(["app", "ls", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      apps: [{ id: "todo" }],
      invalidFiles: [{ id: "broken" }],
    });
  });

  it("an empty registry prints the empty line", async () => {
    expect(await cli(["app", "ls"])).toBe(0);
    expect(out()).toContain(t.app.empty("default_project"));
  });

  it("status re-probes one app (GET ?refresh=1) and prints its status line; unregister DELETEs", async () => {
    process.env.PENGUIN_SESSION_ID = CALLER;
    await cli([
      "app",
      "register",
      "--name",
      "svc",
      "--id",
      "svc",
      "--url",
      "http://localhost:4000",
    ]);
    stdout.length = 0;
    expect(await cli(["app", "status", "svc"])).toBe(0);
    expect(server.requests.at(-1)).toMatchObject({
      method: "GET",
      path: "/api/projects/default_project/apps/svc",
    });
    expect(out().trim()).toBe(t.app.statusLine("svc", "running", "http://localhost:4000"));

    stdout.length = 0;
    expect(await cli(["app", "unregister", "svc"])).toBe(0);
    expect(server.appItems.has("svc")).toBe(false);
    expect(out()).toContain(t.app.unregistered("svc"));
    expect(await cli(["app", "unregister", "svc"])).toBe(1);
  });
});
