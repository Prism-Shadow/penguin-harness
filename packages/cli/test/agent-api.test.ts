/**
 * `penguin agent api …`, driven through `cli()` in-process against the fake server's agent API
 * and admin settings routes.
 *
 * - `keys create` prints the key bare on stdout and everything else on stderr; listing the keys
 *   afterwards names the new one by its prefix, never by the secret.
 * - `enable --open --approve read-only` sends one PUT turning the API on with keyless access and
 *   that approval mode, and prints the status it left; `disable` sends only the switch, so keyless
 *   access and the mode stay as they were.
 * - `set` sends only what it is given; given nothing, it sends nothing and fails.
 * - An unknown `--approve` mode fails before any request.
 * - The agent is never a default: without `--agent-id`, nothing is sent.
 * - `status` shows the server-wide switch to any member, an admin or not, from the agent's own
 *   settings read: the admin settings are never asked.
 * - `server off` / `server on` write the server-wide switch; any other state sends nothing.
 * - `keys rm` deletes the key; an unknown key fails with the server's code.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cli } from "../src/index.js";
import { getMessages } from "../src/i18n.js";
import { FakeServer } from "./fake-server.js";

const t = getMessages("en");
const REF = "default_project/default_agent";
const API = "/api/projects/default_project/agents/default_agent/api";

let server: FakeServer;
let uninstall: () => void;
let stdout: string[];
let stderr: string[];
let restore: Array<{ mockRestore(): void }>;

beforeEach(() => {
  server = new FakeServer();
  uninstall = server.install();
  stdout = [];
  stderr = [];
  restore = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    }),
  ];
});
afterEach(() => {
  for (const spy of restore) spy.mockRestore();
  uninstall();
});

const out = () => stdout.join("");
const err = () => stderr.join("");
/** The writes sent to the agent's API settings and to the admin settings, in order. */
const writes = () =>
  server.requests
    .filter((r) => r.method !== "GET")
    .map((r) => [r.method, r.path, r.body ?? null] as const);

describe("penguin agent api keys", () => {
  it("create prints the key bare on stdout and the rest on stderr", async () => {
    expect(
      await cli(["agent", "api", "keys", "create", "--agent-id", "default_agent", "--name", "ci"]),
    ).toBe(0);
    const [key] = server.agentApi.get(REF)!.keys;
    const [secret] = server.mintedSecrets;
    expect(out()).toBe(`${secret}\n`);
    expect(err()).toBe(`${t.agent.apiKeyCreated("ci", String(key!.prefix), REF)}\n`);
    expect(writes()).toEqual([["POST", `${API}/keys`, { name: "ci" }]]);

    stdout.length = 0;
    expect(await cli(["agent", "api", "keys", "ls", "--agent-id", "default_agent"])).toBe(0);
    expect(out()).toContain(`${String(key!.prefix)}…`);
    expect(out()).toContain(t.agent.apiKeyNever());
    expect(out()).not.toContain(secret!);
  });

  it("rm deletes the key; an unknown key fails with the server's code", async () => {
    await cli(["agent", "api", "keys", "create", "--agent-id", "default_agent", "--name", "ci"]);
    stdout.length = 0;
    expect(await cli(["agent", "api", "keys", "rm", "key1", "--agent-id", "default_agent"])).toBe(
      0,
    );
    expect(out()).toBe(`${t.agent.apiKeyDeleted("key1", REF)}\n`);
    expect(server.agentApi.get(REF)!.keys).toEqual([]);

    expect(await cli(["agent", "api", "keys", "rm", "key1", "--agent-id", "default_agent"])).toBe(
      1,
    );
    expect(err()).toContain("key_not_found");
  });

  it("ls says so when the agent has no keys", async () => {
    expect(await cli(["agent", "api", "keys", "ls", "--agent-id", "default_agent"])).toBe(0);
    expect(out()).toBe(`${t.agent.apiKeysEmpty(REF)}\n`);
  });
});

describe("penguin agent api enable / disable / set", () => {
  it("enable --open --approve read-only sends one PUT and prints the status it left", async () => {
    expect(
      await cli([
        "agent",
        "api",
        "enable",
        "--agent-id",
        "default_agent",
        "--open",
        "--approve",
        "read-only",
      ]),
    ).toBe(0);
    expect(writes()).toEqual([
      ["PUT", API, { enabled: true, open: true, approvalMode: "read-only" }],
    ]);
    const text = out();
    expect(text).toContain(t.agent.apiStatusTitle(REF));
    expect(text).toMatch(new RegExp(`${t.agent.apiFieldEnabled()}\\s+${t.agent.apiYes()}`));
    expect(text).toMatch(new RegExp(`${t.agent.apiFieldOpen()}\\s+${t.agent.apiYes()}`));
    expect(text).toMatch(new RegExp(`${t.agent.apiFieldApproval()}\\s+read-only`));
    expect(text).toContain("http://127.0.0.1:7399/api/amsp/v1");
  });

  it("disable sends only the switch: keyless access and the mode stay as they were", async () => {
    await cli(["agent", "api", "enable", "--agent-id", "default_agent", "--open"]);
    server.requests.length = 0;
    expect(await cli(["agent", "api", "disable", "--agent-id", "default_agent"])).toBe(0);
    expect(writes()).toEqual([["PUT", API, { enabled: false }]]);
    expect(server.agentApi.get(REF)).toMatchObject({ enabled: false, open: true });
  });

  it("set sends only what it is given; given nothing it sends nothing and fails", async () => {
    expect(await cli(["agent", "api", "set", "--agent-id", "default_agent", "--no-open"])).toBe(0);
    expect(writes()).toEqual([["PUT", API, { open: false }]]);

    server.requests.length = 0;
    expect(await cli(["agent", "api", "set", "--agent-id", "default_agent"])).toBe(1);
    expect(err()).toContain(t.agent.apiNothingToSet());
    expect(server.requests).toEqual([]);
  });

  it("an unknown approval mode fails before any request", async () => {
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      expect(
        await cli(["agent", "api", "enable", "--agent-id", "default_agent", "--approve", "ask"]),
      ).toBe(1);
    } finally {
      exit.mockRestore();
    }
    expect(err()).toContain(t.approveModeInvalid("ask"));
    expect(server.requests).toEqual([]);
  });

  it("never picks the agent by default: without --agent-id nothing is sent", async () => {
    expect(await cli(["agent", "api", "enable"])).toBe(1);
    expect(server.requests).toEqual([]);
  });
});

describe("penguin agent api status / server", () => {
  it("status shows the server switch to a member who is not an admin, without asking the admin settings", async () => {
    server.adminSettings = { ...server.adminSettings, agentApiEnabled: false };
    server.adminForbidden = true;
    expect(await cli(["agent", "api", "status", "--agent-id", "default_agent"])).toBe(0);
    expect(out()).toMatch(new RegExp(`${t.agent.apiFieldServer()}\\s+off`));

    stdout.length = 0;
    expect(await cli(["agent", "api", "status", "--agent-id", "default_agent", "--json"])).toBe(0);
    expect(JSON.parse(out())).toEqual({
      agent: REF,
      baseUrl: "http://127.0.0.1:7399/api/amsp/v1",
      api: { enabled: false, open: false, approvalMode: "allow-all", keys: [] },
      serverEnabled: false,
    });
    expect(server.requests.some((r) => r.path === "/api/admin/settings")).toBe(false);
  });

  it("server off and on write the server-wide switch", async () => {
    expect(await cli(["agent", "api", "server", "off"])).toBe(0);
    expect(out()).toBe(`${t.agent.apiServerSet(false)}\n`);
    expect(await cli(["agent", "api", "server", "on", "--json"])).toBe(0);
    expect(writes()).toEqual([
      ["PUT", "/api/admin/settings", { agentApiEnabled: false }],
      ["PUT", "/api/admin/settings", { agentApiEnabled: true }],
    ]);
    expect(out()).toContain(`{"agentApiEnabled":true}`);
  });

  it("server with any other state sends nothing", async () => {
    expect(await cli(["agent", "api", "server", "maybe"])).toBe(1);
    expect(err()).toContain(t.agent.apiServerStateInvalid("maybe"));
    expect(server.requests).toEqual([]);
  });
});
