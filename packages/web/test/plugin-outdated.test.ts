/**
 * The plugin library page's install questions, pure and unit tested:
 * - `pluginInstalled` / `installedPluginVersion` — a plugin is installed on an Agent when any
 *   part of it is there (a skill, or the hook package when it ships one), read off the two
 *   installed lists the page fetches per Agent;
 * - `outdatedAgentIds`, the per-plugin reminder's data source — the Agents the SERVER lists as
 *   behind on it (`AgentSummary.pluginUpdates`), since versions are `YYYY-MM-DD.N` strings the
 *   web never compares itself;
 * - `pluginUpdatePlan`, the page notice's "update all of them" version of the same question.
 */
import { describe, expect, it } from "vitest";
import {
  installedPluginVersion,
  outdatedAgentIds,
  pluginInstalled,
  pluginUpdatePlan,
} from "../src/features/plugins/plugins-page";
import type { AgentInstalls, PluginParts } from "../src/features/plugins/plugins-page";

const skill = (name: string) => ({ name, description: "", version: "2026-08-01.1" });

/** A plugin shipping two skills and a stop hook, one with a skill only, and one with a hook only. */
const FULL: PluginParts = {
  name: "orchestration",
  skills: [skill("plan"), skill("run")],
  hooks: ["stop"],
};
const SKILL_ONLY: PluginParts = { name: "web-design", skills: [skill("web-design")], hooks: [] };
const HOOK_ONLY: PluginParts = { name: "goal", skills: [], hooks: ["stop"] };

const installs = (
  skills: Record<string, string>,
  hooks: Record<string, string>,
): AgentInstalls => ({
  skills: new Map(Object.entries(skills)),
  hooks: new Map(Object.entries(hooks)),
});

describe("pluginInstalled", () => {
  it("counts a plugin as installed once any part of it is there, so a partial copy can be updated", () => {
    const whole = installs(
      { plan: "2026-08-01.1", run: "2026-08-01.1" },
      { orchestration: "2026-08-01.1" },
    );
    expect(pluginInstalled(FULL, whole)).toBe(true);
    // An older version that shipped one skill fewer, or a copy missing its hook package, is
    // what the server lists as behind: an installed plugin an update completes.
    expect(
      pluginInstalled(FULL, installs({ plan: "2026-08-01.1" }, { orchestration: "2026-08-01.1" })),
    ).toBe(true);
    expect(pluginInstalled(FULL, installs({ plan: "2026-08-01.1", run: "2026-08-01.1" }, {}))).toBe(
      true,
    );
    expect(pluginInstalled(FULL, installs({ other: "2026-08-01.1" }, {}))).toBe(false);
  });

  it("reads a skill-only plugin off the skills list and a hook-only one off the hooks list", () => {
    expect(pluginInstalled(SKILL_ONLY, installs({ "web-design": "2026-07-30.1" }, {}))).toBe(true);
    expect(pluginInstalled(SKILL_ONLY, installs({}, { "web-design": "2026-07-30.1" }))).toBe(false);
    expect(pluginInstalled(HOOK_ONLY, installs({}, { goal: "2026-08-29.1" }))).toBe(true);
    expect(pluginInstalled(HOOK_ONLY, installs({ goal: "2026-08-29.1" }, {}))).toBe(false);
  });

  it("is false for an Agent with no snapshot yet, and for a plugin that ships nothing", () => {
    expect(pluginInstalled(SKILL_ONLY, undefined)).toBe(false);
    expect(pluginInstalled({ name: "empty", skills: [], hooks: [] }, installs({}, {}))).toBe(false);
  });
});

describe("installedPluginVersion", () => {
  it("reads the hook package's version where there is one, else the first skill's", () => {
    expect(
      installedPluginVersion(
        FULL,
        installs({ plan: "2026-07-01.1", run: "2026-07-01.1" }, { orchestration: "2026-07-02.1" }),
      ),
    ).toBe("2026-07-02.1");
    expect(installedPluginVersion(SKILL_ONLY, installs({ "web-design": "2026-07-30.1" }, {}))).toBe(
      "2026-07-30.1",
    );
  });

  it("is undefined where the plugin is not installed, and reads a partial copy's first installed skill", () => {
    expect(installedPluginVersion(SKILL_ONLY, undefined)).toBeUndefined();
    expect(
      installedPluginVersion(SKILL_ONLY, installs({ other: "2026-07-01.1" }, {})),
    ).toBeUndefined();
    expect(
      installedPluginVersion(
        { name: "pair", skills: [skill("plan"), skill("run")], hooks: [] },
        installs({ run: "2026-07-01.1" }, {}),
      ),
    ).toBe("2026-07-01.1");
  });
});

/** Just the two fields the update questions read (they take a Pick, so the fixture can be one too). */
const agent = (agentId: string, ...updates: Array<{ name: string; version: string }>) => ({
  agentId,
  pluginUpdates: updates,
});

describe("outdatedAgentIds", () => {
  it("names the Agents the server lists as behind on that plugin, in list order", () => {
    const agents = [
      agent("stale", { name: "web-design", version: "2026-08-01.1" }),
      agent("current"),
      agent("other", { name: "vllm", version: "2026-08-01.1" }),
      agent(
        "also_stale",
        { name: "web-design", version: "2026-08-01.1" },
        { name: "vllm", version: "2026-08-01.1" },
      ),
    ];
    expect(outdatedAgentIds(agents, "web-design")).toEqual(["stale", "also_stale"]);
    expect(outdatedAgentIds(agents, "vllm")).toEqual(["other", "also_stale"]);
    expect(outdatedAgentIds(agents, "goal")).toEqual([]);
  });
});

describe("pluginUpdatePlan", () => {
  it("is empty when no Agent is behind, so the notice has nothing to offer", () => {
    expect(pluginUpdatePlan([agent("a"), agent("b")])).toEqual({ perAgent: [], plugins: [] });
  });

  it("sends one request per Agent, carrying every plugin that Agent is behind on", () => {
    // The install endpoint takes a list, and an Agent behind on two plugins is one overwrite
    // either way.
    expect(
      pluginUpdatePlan([
        agent(
          "alpha",
          { name: "web-design", version: "2026-08-01.3" },
          { name: "vllm", version: "2026-08-01.2" },
        ),
        agent("beta"),
        agent("gamma", { name: "web-design", version: "2026-08-01.3" }),
      ]),
    ).toEqual({
      perAgent: [
        { agentId: "alpha", names: ["vllm", "web-design"] },
        { agentId: "gamma", names: ["web-design"] },
      ],
      plugins: ["vllm", "web-design"],
    });
  });

  it("counts distinct plugins, matching what the notice above the button says", () => {
    // The gate counts by plugin because the page lists the library once. The plan's `plugins`
    // is what the confirmation lists, so the two must be the same number or the dialog would
    // contradict the block that opened it.
    const plan = pluginUpdatePlan([
      agent("alpha", { name: "shared", version: "2026-08-01.2" }),
      agent("beta", { name: "shared", version: "2026-08-01.2" }),
      agent("gamma", { name: "shared", version: "2026-08-01.2" }),
    ]);
    expect(plan.plugins).toEqual(["shared"]);
    expect(plan.perAgent).toHaveLength(3);
  });
});
