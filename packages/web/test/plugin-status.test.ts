/**
 * A plugin's install status on the Plugins page (features/plugins/plugin-status.ts).
 *
 * - A plugin of Skills and hooks is installed once one Agent of the Project carries all of it;
 *   a partial copy is not — unless the server lists that Agent as behind on it, which is an
 *   update (the update completes it). With no Agent carrying it, it is available.
 * - An Agent the server lists as behind whose snapshot shows nothing of the plugin any more
 *   (just uninstalled here) is neither behind nor using it; a plugin that ships nothing is on
 *   no Agent.
 * - A server module is installed when this server runs it, and otherwise waits for a restart,
 *   failed to load, runs elsewhere (or has not reached the machine in view yet), or is not
 *   listed; the module's state decides for a plugin that also ships Skills, whose Agents are
 *   still counted.
 * - The update dialog lists, per Agent, each part whose installed version differs from the
 *   library's — older, or raised by a local edit — and no part the Agent does not carry; an MCP
 *   server the Agent carries is listed as replaced (an entry carries no version).
 * - A plugin of MCP servers alone is installed on an Agent whose server list carries each of
 *   them under the plugin's name, waiting for setup or not; a server of the same name the user
 *   added, or another plugin installed, is not the plugin's.
 * - What the plugin's servers on an Agent wait for: the vault keys they miss, once each, and
 *   whether one needs a sign-in; installing asks first only where a stdio server is new to the
 *   Agent.
 */
import { describe, expect, it } from "vitest";
import type { AgentMcpServerItem, PluginMcpServerItem } from "@prismshadow/penguin-server/api";
import {
  changedParts,
  installNeedsConfirm,
  libraryUsage,
  pluginMcpState,
  pluginStatus,
  type AgentInstalls,
  type InstalledMap,
  type ModuleState,
  type PluginParts,
} from "../src/features/plugins/plugin-status";

const skill = (name: string, version = "2026.10.04.1") => ({ name, description: "", version });

/** Two Skills and a stop hook: what agent-company-like plugins look like. */
const PAIR: PluginParts & { hookVersion: string } = {
  name: "pair",
  skills: [skill("plan"), skill("run", "2026.10.09.1")],
  hooks: ["stop"],
  hookVersion: "2026.10.04.1",
  mcpServers: [],
};

const installs = (
  skills: Record<string, string>,
  hooks: Record<string, string> = {},
  servers: AgentMcpServerItem[] = [],
) =>
  ({
    skills: new Map(Object.entries(skills)),
    hooks: new Map(Object.entries(hooks)),
    mcp: new Map(servers.map((server) => [server.name, server])),
  }) satisfies AgentInstalls;

/** A plugin's server as the library lists it. */
const libraryServer = (
  name: string,
  transport: PluginMcpServerItem["transport"] = "http",
): PluginMcpServerItem => ({
  name,
  transport,
  target: transport === "stdio" ? "node ${PLUGIN_ROOT}/server.mjs" : `https://${name}.example/mcp`,
  setup: [],
  oauth: false,
  signIn: false,
});

/** One of an Agent's servers, installed by `plugin` (absent: the user's own). */
const agentServer = (
  name: string,
  plugin: string | undefined,
  missingKeys: string[] = [],
  signIn = false,
): AgentMcpServerItem => ({
  name,
  transport: "http",
  target: `https://${name}.example/mcp`,
  ...(plugin !== undefined ? { plugin } : {}),
  missingKeys,
  signIn,
});

const agent = (agentId: string, ...behindOn: string[]) => ({
  agentId,
  pluginUpdates: behindOn.map((name) => ({ name, version: "2026.10.09.1" })),
});

const statusOf = (installed: InstalledMap, agents: ReturnType<typeof agent>[]) =>
  pluginStatus({}, libraryUsage(PAIR, agents, installed));

describe("a plugin of Skills and hooks", () => {
  it("is installed once one Agent carries every part, and available while nobody does", () => {
    const whole = installs({ plan: "2026.10.04.1", run: "2026.10.09.1" }, { pair: "2026.10.04.1" });
    expect(statusOf(new Map([["a", whole]]), [agent("a"), agent("b")])).toBe("installed");
    expect(libraryUsage(PAIR, [agent("a"), agent("b")], new Map([["a", whole]]))).toEqual({
      usedBy: ["a"],
      behind: [],
    });
    expect(statusOf(new Map(), [agent("a")])).toBe("available");
  });

  it("counts a partial copy as not installed, unless the server lists it as behind — then it is an update", () => {
    // A skill added to the library after the install: the copy lacks it, and nothing is behind.
    const partial = new Map([["a", installs({ plan: "2026.10.04.1" }, { pair: "2026.10.04.1" })]]);
    expect(statusOf(partial, [agent("a")])).toBe("available");
    expect(statusOf(partial, [agent("a", "pair")])).toBe("update");
    expect(libraryUsage(PAIR, [agent("a", "pair")], partial)).toEqual({
      usedBy: ["a"],
      behind: ["a"],
    });
  });

  it("drops an Agent the server lists as behind once its snapshot shows nothing of the plugin", () => {
    const usage = libraryUsage(PAIR, [agent("gone", "pair")], new Map([["gone", installs({})]]));
    expect(usage).toEqual({ usedBy: [], behind: [] });
  });

  it("puts a plugin that ships nothing on no Agent", () => {
    const empty: PluginParts = { name: "empty", skills: [], hooks: [], mcpServers: [] };
    expect(libraryUsage(empty, [agent("a")], new Map([["a", installs({})]])).usedBy).toEqual([]);
  });
});

describe("a server module", () => {
  it.each<[ModuleState, string]>([
    ["active", "installed"],
    ["pending", "restart"],
    ["failed", "failed"],
    ["elsewhere", "not-here"],
    ["unsynced", "not-here"],
    ["none", "available"],
  ])("in state %s reads as %s", (state, status) => {
    expect(pluginStatus({ module: { state } }, null)).toBe(status);
  });

  it("decides for a plugin that also ships Skills, whose Agents still count", () => {
    const behind = libraryUsage(
      PAIR,
      [agent("a", "pair")],
      new Map([["a", installs({ plan: "1" })]]),
    );
    expect(pluginStatus({ module: { state: "active" } }, behind)).toBe("installed");
    expect(behind.usedBy).toEqual(["a"]);
  });
});

describe("what an update rewrites", () => {
  it("names each carried part whose version differs, older or locally raised, and nothing else", () => {
    const copy = installs(
      // plan is behind; run was edited by the Agent and raised past the library's.
      { plan: "2026.09.01.1", run: "2026.10.12.4" },
      { pair: "2026.10.04.1" },
    );
    expect(changedParts(PAIR, copy)).toEqual([
      { kind: "skill", name: "plan", installed: "2026.09.01.1", library: "2026.10.04.1" },
      { kind: "skill", name: "run", installed: "2026.10.12.4", library: "2026.10.09.1" },
    ]);
    expect(changedParts(PAIR, installs({}, { pair: "2026-09-01.1" }))).toEqual([
      { kind: "hooks", name: "pair", installed: "2026-09-01.1", library: "2026.10.04.1" },
    ]);
    expect(changedParts(PAIR, undefined)).toEqual([]);
  });

  it("lists an MCP server the Agent carries as replaced, and none it does not", () => {
    const tools: PluginParts & { hookVersion?: string } = {
      ...PAIR,
      mcpServers: [libraryServer("web"), libraryServer("local", "stdio")],
    };
    const copy = installs({ plan: "2026.10.04.1", run: "2026.10.09.1" }, { pair: "2026.10.04.1" }, [
      agentServer("web", "pair"),
    ]);
    expect(changedParts(tools, copy)).toEqual([
      { kind: "mcp", name: "web", installed: "", library: "" },
    ]);
  });
});

describe("a plugin of MCP servers", () => {
  const MAIL: PluginParts = {
    name: "mail",
    skills: [],
    hooks: [],
    mcpServers: [libraryServer("mail"), libraryServer("calendar")],
  };
  const usage = (servers: AgentMcpServerItem[]) =>
    libraryUsage(MAIL, [agent("a")], new Map([["a", installs({}, {}, servers)]]));

  it("is installed on an Agent carrying each of its servers under its name, waiting for setup or not", () => {
    const both = [
      agentServer("mail", "mail", ["MAIL_CLIENT_ID"], true),
      agentServer("calendar", "mail"),
    ];
    expect(usage(both).usedBy).toEqual(["a"]);
    expect(pluginStatus({}, usage(both))).toBe("installed");
    expect(usage([agentServer("mail", "mail")]).usedBy).toEqual([]);
  });

  it("is not on an Agent whose server of that name the user added, or another plugin installed", () => {
    expect(usage([agentServer("mail", undefined), agentServer("calendar", "mail")]).usedBy).toEqual(
      [],
    );
    expect(usage([agentServer("mail", "other"), agentServer("calendar", "mail")]).usedBy).toEqual(
      [],
    );
  });

  it("says what its servers on an Agent wait for: each missing key once, and a sign-in", () => {
    const state = pluginMcpState(
      MAIL,
      installs({}, {}, [
        agentServer("mail", "mail", ["MAIL_CLIENT_ID", "MAIL_CLIENT_SECRET"], true),
        agentServer("calendar", "mail", ["MAIL_CLIENT_ID"]),
      ]),
    );
    expect(state).toEqual({ missingKeys: ["MAIL_CLIENT_ID", "MAIL_CLIENT_SECRET"], signIn: true });
    expect(pluginMcpState(MAIL, installs({}))).toBeNull();
  });

  it("asks before installing only where a stdio server is new to the Agent", () => {
    const local: PluginParts = { ...MAIL, mcpServers: [libraryServer("local", "stdio")] };
    expect(installNeedsConfirm(local, installs({}))).toBe(true);
    expect(installNeedsConfirm(local, installs({}, {}, [agentServer("local", "mail")]))).toBe(
      false,
    );
    expect(installNeedsConfirm(MAIL, installs({}))).toBe(false);
  });
});
