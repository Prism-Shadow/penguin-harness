/**
 * `penguin app` — inspect and operate a Project's Apps (workbenches), driven through `cli()`
 * in-process against the fake server.
 *
 * - Given shown, hidden, and disabled Apps across Agents, `app ls` lists only active shown Apps
 *   with canonical `<agentId>/<workbenchId>` IDs; `-a` includes hidden and disabled Apps;
 *   `--agent-id` narrows to one Agent; `--json` carries `appId` on every item.
 * - Given an explicit `<agentId>/<workbenchId>`, `app info` prints its details and `--json`
 *   includes `appId`, `agentId`, and `agentEnabled`; an unknown App exits 1 with a not-found error.
 * - Given `PENGUIN_APP_ID` in the environment and no positional argument, `app info`, `reload`,
 *   `enable`, `disable`, `history`, and `call /path` target that App without needing an explicit id.
 * - Given a bare `<workbenchId>`, `--agent-id` or `PENGUIN_AGENT_ID` supplies the Agent prefix;
 *   without either, it exits 1 and makes no request.
 * - Given a `sessionId` where an App id is expected, or a malformed id, or an `--agent-id` that
 *   conflicts with the App id's prefix, it exits 1 with a specific error and makes no request.
 * - Given `app reload`, a clean reload exits 0 and prints hints; a reload with a compile error
 *   exits 1 and reports the error (and still prints the JSON with `--json`).
 * - Given `app enable` and `app disable`, the workbench switch is toggled via PUT `/:id/enabled`.
 * - Given `app history`, recorded versions are tabulated (or an empty notice when none exist).
 * - Given `app call`, GET is default, `--data` defaults to POST and sends JSON, non-JSON replies
 *   print verbatim, `/path` alone uses `PENGUIN_APP_ID`, and invalid methods, invalid JSON,
 *   bodyless `--data`, missing paths, or traversal paths (`/../`) exit 1 without sending a request.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { FakeServer } from "./fake-server.js";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let outSpy: { mockRestore(): void };
let errSpy: { mockRestore(): void };
let priorLang: string | undefined;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  priorLang = process.env.PENGUIN_LANG;
  process.env.PENGUIN_LANG = "en";
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
  if (priorLang === undefined) delete process.env.PENGUIN_LANG;
  else process.env.PENGUIN_LANG = priorLang;
  uninstall();
});

const out = () => stdout.join("");
const err = () => stderr.join("");

describe("penguin app ls", () => {
  it("lists active shown apps with canonical <agentId>/<workbenchId> ids, and supports -a, --agent-id, and --json", async () => {
    server.addApp({
      agentId: "default_agent",
      workbenchId: "slides",
      title: "Slides",
      titleZh: "幻灯片",
      tab: "deck",
      plugin: "use-bento-slides",
    });
    server.addApp({
      agentId: "helper",
      workbenchId: "hidden-tool",
      title: "Hidden Tool",
      hidden: true,
    });
    server.addApp({
      agentId: "helper",
      workbenchId: "off-tool",
      title: "Off Tool",
      enabled: false,
    });

    // Default ls shows only enabled, non-hidden apps.
    expect(await cli(["app", "ls"])).toBe(0);
    expect(out()).toContain("default_agent/slides");
    expect(out()).toContain("Slides");
    expect(out()).not.toContain("helper/hidden-tool");
    expect(out()).not.toContain("helper/off-tool");

    // -a includes hidden and disabled apps with status tags.
    stdout.length = 0;
    expect(await cli(["app", "ls", "-a"])).toBe(0);
    expect(out()).toContain("default_agent/slides");
    expect(out()).toContain("helper/hidden-tool");
    expect(out()).toContain("ready (hidden)");
    expect(out()).toContain("helper/off-tool");
    expect(out()).toContain("disabled");

    // --agent-id narrows the list to that Agent.
    stdout.length = 0;
    expect(await cli(["app", "ls", "-a", "--agent-id", "helper", "--json"])).toBe(0);
    const items = JSON.parse(out()) as Array<{ appId: string; enabled: boolean; hidden: boolean }>;
    expect(items.map((i) => i.appId)).toEqual(["helper/hidden-tool", "helper/off-tool"]);
    expect(items[0]).toMatchObject({ enabled: true, hidden: true });
    expect(items[1]).toMatchObject({ enabled: false, hidden: false });

    // Chinese locale renders titleZh.
    stdout.length = 0;
    process.env.PENGUIN_LANG = "zh";
    expect(await cli(["app", "ls"])).toBe(0);
    expect(out()).toContain("幻灯片");
  });

  it("prints an empty notice when the project has no apps", async () => {
    expect(await cli(["app", "ls"])).toBe(0);
    expect(out()).toContain("No apps in project default_project yet.");
  });
});

describe("penguin app id resolution & info", () => {
  it("inspects an explicit app id and returns structured JSON with --json", async () => {
    server.addApp({
      agentId: "default_agent",
      workbenchId: "slides",
      title: "Slides",
      hints: ["unused file ui/draft.html"],
    });

    expect(await cli(["app", "info", "default_agent/slides"])).toBe(0);
    expect(out()).toContain("ID: default_agent/slides");
    expect(out()).toContain("Status: enabled");
    expect(out()).toContain("unused file ui/draft.html");

    stdout.length = 0;
    expect(await cli(["app", "info", "default_agent/slides", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({
      appId: "default_agent/slides",
      agentId: "default_agent",
      id: "slides",
      agentEnabled: true,
    });

    // When the Agent-wide switch is off, info reports the app as disabled (agent switch off).
    server.addApp({
      agentId: "paused_agent",
      workbenchId: "tool",
      enabled: true,
      agentEnabled: false,
    });
    stdout.length = 0;
    expect(await cli(["app", "info", "paused_agent/tool"])).toBe(0);
    expect(out()).toContain("Status: disabled (agent switch off)");
  });

  it("falls back to PENGUIN_APP_ID when app-id is omitted, and resolves bare workbenchId via --agent-id or PENGUIN_AGENT_ID", async () => {
    server.addApp({ agentId: "owner_a", workbenchId: "board", title: "Board" });

    // PENGUIN_APP_ID fallback (even when running as another agent in PENGUIN_AGENT_ID).
    process.env.PENGUIN_APP_ID = "owner_a/board";
    process.env.PENGUIN_AGENT_ID = "worker_b";
    expect(await cli(["app", "info", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ appId: "owner_a/board" });

    // Bare workbenchId with explicit --agent-id.
    stdout.length = 0;
    delete process.env.PENGUIN_APP_ID;
    expect(await cli(["app", "info", "board", "--agent-id", "owner_a", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ appId: "owner_a/board" });

    // Bare workbenchId with PENGUIN_AGENT_ID.
    stdout.length = 0;
    process.env.PENGUIN_AGENT_ID = "owner_a";
    expect(await cli(["app", "info", "board", "--json"])).toBe(0);
    expect(JSON.parse(out())).toMatchObject({ appId: "owner_a/board" });
  });

  it("exits 1 with a not-found error when the app does not exist", async () => {
    expect(await cli(["app", "info", "default_agent/missing"])).toBe(1);
    expect(err()).toContain("No such app: default_agent/missing");
  });

  it("rejects missing ids, session ids, malformed ids, missing agent prefix, and conflicting --agent-id before making any request", async () => {
    expect(await cli(["app", "info"])).toBe(1);
    expect(err()).toContain("PENGUIN_APP_ID");

    stderr.length = 0;
    expect(await cli(["app", "info", "session-2026-11-24-10-00-00-abcd1234"])).toBe(1);
    expect(err()).toContain("session id");

    stderr.length = 0;
    expect(await cli(["app", "info", "a/b/c"])).toBe(1);
    expect(err()).toContain("Invalid app id");

    stderr.length = 0;
    expect(await cli(["app", "info", "bare-app"])).toBe(1);
    expect(err()).toContain("no agent prefix");

    stderr.length = 0;
    expect(await cli(["app", "info", "agent_a/slides", "--agent-id", "agent_b"])).toBe(1);
    expect(err()).toContain("conflicts with --agent-id");

    expect(server.requests).toHaveLength(0);
  });
});

describe("penguin app reload, enable, disable, history", () => {
  it("reloads an app, printing hints on success and exiting 1 on compile error", async () => {
    const app = server.addApp({
      agentId: "default_agent",
      workbenchId: "slides",
      hints: ["check ui/extra.html"],
    });
    expect(await cli(["app", "reload", "default_agent/slides"])).toBe(0);
    expect(out()).toContain("Reloaded default_agent/slides");
    expect(out()).toContain("check ui/extra.html");

    stdout.length = 0;
    stderr.length = 0;
    app.error = "index.ts(1,1): TS2304: Cannot find name 'oops'";
    expect(await cli(["app", "reload", "default_agent/slides"])).toBe(1);
    expect(err()).toContain("TS2304");

    stdout.length = 0;
    stderr.length = 0;
    expect(await cli(["app", "reload", "default_agent/slides", "--json"])).toBe(1);
    expect(JSON.parse(out())).toMatchObject({
      appId: "default_agent/slides",
      error: app.error,
    });
  });

  it("toggles an app's enabled state and lists its version history", async () => {
    const app = server.addApp({ agentId: "default_agent", workbenchId: "slides" });

    expect(await cli(["app", "disable", "default_agent/slides"])).toBe(0);
    expect(app.enabled).toBe(false);
    expect(out()).toContain("Disabled default_agent/slides.");

    stdout.length = 0;
    expect(await cli(["app", "enable", "default_agent/slides"])).toBe(0);
    expect(app.enabled).toBe(true);
    expect(out()).toContain("Enabled default_agent/slides.");

    stdout.length = 0;
    expect(await cli(["app", "history", "default_agent/slides"])).toBe(0);
    expect(out()).toContain("abc123def456");

    stdout.length = 0;
    app.versions = [];
    expect(await cli(["app", "history", "default_agent/slides"])).toBe(0);
    expect(out()).toContain("No recorded versions");
  });
});

describe("penguin app call", () => {
  it("sends GET by default, POST when --data is passed, supports /path shorthand via PENGUIN_APP_ID, and handles plain-text responses", async () => {
    server.addApp({
      agentId: "default_agent",
      workbenchId: "slides",
      onApi: ({ method, path, body }) => {
        if (path === "/text") {
          return new Response("plain hello", {
            status: 200,
            headers: { "content-type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(JSON.stringify({ method, path, body }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    });

    // Explicit app-id + GET path.
    expect(await cli(["app", "call", "default_agent/slides", "/status"])).toBe(0);
    expect(JSON.parse(out())).toEqual({ method: "GET", path: "/status", body: null });

    // --data defaults to POST and sends parsed JSON.
    stdout.length = 0;
    expect(
      await cli(["app", "call", "default_agent/slides", "/decks", "-d", '{"title":"Q4"}']),
    ).toBe(0);
    expect(JSON.parse(out())).toEqual({ method: "POST", path: "/decks", body: { title: "Q4" } });

    // /path alone uses PENGUIN_APP_ID.
    stdout.length = 0;
    process.env.PENGUIN_APP_ID = "default_agent/slides";
    expect(await cli(["app", "call", "/text"])).toBe(0);
    expect(out()).toBe("plain hello\n");
  });

  it("refuses missing path, traversal paths, invalid methods, invalid JSON, and --data on GET without calling the server", async () => {
    process.env.PENGUIN_APP_ID = "default_agent/slides";

    expect(await cli(["app", "call", "default_agent/slides"])).toBe(1);
    expect(err()).toContain("Missing API path");

    for (const badPath of [
      "status",
      "//evil.com/x",
      "/../other/api/x",
      "/%2e%2e/secret",
      "/a#b",
      "/with space",
      "/with\nnewline",
    ]) {
      stderr.length = 0;
      expect(await cli(["app", "call", "default_agent/slides", badPath])).toBe(1);
      expect(err()).toContain("Invalid API path");
    }

    stderr.length = 0;
    expect(await cli(["app", "call", "/status", "-X", "TRACE"])).toBe(1);
    expect(err()).toContain("Invalid HTTP method");

    stderr.length = 0;
    expect(await cli(["app", "call", "/status", "-X", "GET", "-d", "{}"])).toBe(1);
    expect(err()).toContain("HTTP GET");

    stderr.length = 0;
    expect(await cli(["app", "call", "/status", "-d", "{bad"])).toBe(1);
    expect(err()).toContain("Invalid --data JSON");

    expect(server.requests).toHaveLength(0);
  });
});
