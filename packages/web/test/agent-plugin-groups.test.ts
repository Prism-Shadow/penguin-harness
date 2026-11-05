/**
 * Which plugin each of an Agent's parts belongs to, as the Agent settings Plugins tab lists them
 * (features/plugins/agent-plugin-groups.ts).
 *
 * - Given a library plugin, its Skills (by name), its hook package (by the plugin's name), its MCP
 *   entries (by their `plugin`) and its workbenches (by their receipts) are listed under it; a
 *   Skill, hook package or workbench nothing names is the user's own, and an MCP entry the user
 *   added is listed nowhere.
 * - Given a plugin an admin removed from the library, the parts its records name stay under it,
 *   marked "not in library"; its Skills can no longer be told apart and are the user's, and a hook
 *   package named after nothing anyone knows is the user's too.
 * - A plugin the server lists the Agent as behind on reads "update"; one missing a part reads
 *   "incomplete"; one with every part reads "installed".
 */
import { describe, expect, it } from "vitest";
import type {
  AgentMcpServerItem,
  AgentPluginsInstallResponse,
  PluginItem,
  WorkbenchInfo,
} from "@prismshadow/penguin-server/api";
import { agentPluginGroups } from "../src/features/plugins/agent-plugin-groups";

const skill = (name: string) => ({ name, description: "", version: "1" });
const hook = (name: string) => ({ name, description: "", version: "1", events: ["stop"] });
const mcp = (name: string, plugin?: string): AgentMcpServerItem => ({
  name,
  transport: "http",
  target: `https://${name}.example`,
  ...(plugin !== undefined ? { plugin } : {}),
  missingKeys: [],
  signIn: false,
});
const workbench = (id: string) => ({ id, name: id }) as WorkbenchInfo;

const CHARTS = {
  name: "charts",
  skills: [skill("chart"), skill("plot")],
  hooks: ["stop"],
  mcpServers: [{ name: "chart-api" }],
  workbenches: [{ name: "board", version: "1" }],
} as unknown as PluginItem;

const installed = (
  over: Partial<AgentPluginsInstallResponse> = {},
): AgentPluginsInstallResponse => ({
  skills: [skill("chart"), skill("plot"), skill("notes")],
  hooks: [hook("charts"), hook("mine")],
  mcpServers: [mcp("chart-api", "charts"), mcp("my-api")],
  workbenches: [{ name: "board", plugin: "charts", version: "1" }],
  ...over,
});

const names = (parts: { skills: { name: string }[]; hooks: { name: string }[] }) => ({
  skills: parts.skills.map((s) => s.name),
  hooks: parts.hooks.map((h) => h.name),
});

describe("an Agent's parts by plugin", () => {
  it("lists a library plugin's parts under it, and what nothing names as the user's own", () => {
    const { groups, own } = agentPluginGroups(
      [CHARTS],
      installed(),
      [workbench("board"), workbench("todo")],
      [],
    );
    expect(groups.map((g) => g.name)).toEqual(["charts"]);
    const [charts] = groups;
    expect(names(charts!.parts)).toEqual({ skills: ["chart", "plot"], hooks: ["charts"] });
    expect(charts!.parts.mcpServers.map((m) => m.name)).toEqual(["chart-api"]);
    expect(charts!.parts.workbenches.map((w) => w.id)).toEqual(["board"]);
    expect(names(own)).toEqual({ skills: ["notes"], hooks: ["mine"] });
    expect(own.workbenches.map((w) => w.id)).toEqual(["todo"]);
    expect(own.mcpServers).toEqual([]);
  });

  it("keeps the recorded parts of a plugin gone from the library, and gives its Skills to the user", () => {
    const { groups, own } = agentPluginGroups([], installed(), [workbench("board")], []);
    expect(groups.map((g) => [g.name, g.status, g.plugin])).toEqual([
      ["charts", "not-in-library", null],
    ]);
    expect(names(groups[0]!.parts)).toEqual({ skills: [], hooks: ["charts"] });
    expect(groups[0]!.parts.workbenches.map((w) => w.id)).toEqual(["board"]);
    expect(names(own)).toEqual({ skills: ["chart", "plot", "notes"], hooks: ["mine"] });
  });

  it.each([
    { state: "behind the library", lists: installed(), behind: ["charts"], status: "update" },
    {
      state: "missing a part",
      lists: installed({ skills: [skill("chart")] }),
      behind: [],
      status: "incomplete",
    },
    { state: "whole", lists: installed(), behind: [], status: "installed" },
  ])("reads a plugin $state as $status", ({ lists, behind, status }) => {
    const updates = behind.map((name) => ({ name, version: "2" }));
    const { groups } = agentPluginGroups([CHARTS], lists, [workbench("board")], updates);
    expect(groups[0]!.status).toBe(status);
  });
});
