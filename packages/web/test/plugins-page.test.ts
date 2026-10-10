/**
 * The Plugins page's pure decisions (features/plugins/plugins-page.tsx). One file, so the page
 * module is imported once.
 *
 * - The page views one machine. This server: its own table and the shared one, a shared row
 *   tagged and not removable, its own rows removable, another machine's plugin offered; a
 *   plugin in this server's table alone counts as installed. Another machine: the state that
 *   machine reports, and what it has not received yet.
 * - An installed row carries the version on that machine's disk, not the registry's. An entry
 *   for another platform than the machine in view's is marked and sorted last; unknown
 *   platforms mark nothing.
 * - A plugin is installed on an Agent once any part of it is there (a skill, or its hook
 *   package), read off the two installed lists; nothing is installed for an Agent with no
 *   snapshot or for a plugin that ships nothing.
 * - The installed version is the hook package's where there is one, else the first installed
 *   skill's, and undefined where the plugin is not installed.
 * - The per-plugin reminder names the Agents the server lists as behind on it, in list order
 *   (versions are never compared here).
 * - The "update all" plan is empty when no Agent is behind, sends one request per Agent with
 *   every plugin it is behind on, and counts distinct plugins as the notice does.
 */
import { describe, expect, it } from "vitest";
import type { InstalledPluginsResponse, PluginIndexEntry } from "@prismshadow/penguin-server/api";
import {
  availablePluginRows,
  installedPluginRows,
  installedPluginVersion,
  outdatedAgentIds,
  pluginInstalled,
  pluginUpdatePlan,
  rowFacets,
  type AgentInstalls,
  type PluginParts,
  type PluginView,
} from "../src/features/plugins/plugins-page";

const SELF = "Self000000000000";
const GPU = "Gpu0000000000000";

const row = (
  specifier: string,
  where: { everywhere: boolean; machines: string[]; here: boolean },
  active = where.here,
): InstalledPluginsResponse["plugins"][number] => ({
  specifier,
  active,
  builtin: false,
  modules: [],
  replaces: [],
  ...where,
});

const deployment: InstalledPluginsResponse = {
  plugins: [
    row("@acme/shared", { everywhere: true, machines: [], here: true }),
    row("@acme/gpu-only", { everywhere: false, machines: [GPU], here: false }),
    row("@acme/self-only", { everywhere: false, machines: [SELF], here: true }),
  ],
  shipped: [],
  file: ".project_config.toml",
  machineId: SELF,
  restartPending: false,
};

const modules = (rows: ReturnType<typeof installedPluginRows>) =>
  rows.flatMap((r) => (r.kind === "module" ? [r] : []));

/** One registry entry, as the merged index would list it — optionally for one platform only. */
const entry = (name: string, os?: string[]): PluginIndexEntry => ({
  name,
  version: "0.2.3",
  description: `${name}, as the registry describes it`,
  authors: [],
  license: "MIT",
  ...(os === undefined ? {} : { os }),
});

describe("plugin rows per machine", () => {
  it("this server: its own table and the shared one, and only its own rows can be removed", () => {
    const view: PluginView = { machineId: SELF, remote: null };
    const rows = modules(installedPluginRows([], "en", deployment, [], view));
    expect(rows.map((r) => [r.specifier, r.state, r.shared])).toEqual([
      ["@acme/shared", "active", true],
      ["@acme/self-only", "active", undefined],
    ]);
    // Only for another machine: offered here as usual.
    expect(availablePluginRows({ ...deployment, shipped: ["@acme/gpu-only"] }, [], view)).toEqual([
      expect.objectContaining({ specifier: "@acme/gpu-only", state: "none" }),
    ]);
  });

  it("a plugin installed for this server alone is not offered again", () => {
    const failing: InstalledPluginsResponse = {
      ...deployment,
      plugins: [row("@acme/self-only", { everywhere: false, machines: [SELF], here: true }, false)],
      shipped: ["@acme/self-only"],
    };
    failing.plugins[0]!.error = "load failed";
    // No view: this server, before any machine is picked.
    const rows = modules(installedPluginRows([], "en", failing, []));
    expect(rows.map((r) => [r.specifier, r.state, r.shared])).toEqual([
      ["@acme/self-only", "failed", undefined],
    ]);
    expect(availablePluginRows(failing, [])).toEqual([]);
  });

  it("another machine: the state it reports, and what it has not received yet", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [row("@acme/gpu-only", { everywhere: true, machines: [], here: true }, false)],
    };
    remote.plugins[0]!.error = "npm: 404";
    const view: PluginView = { machineId: GPU, remote };
    const rows = modules(installedPluginRows([], "en", deployment, [], view));
    expect(rows.map((r) => [r.specifier, r.state, r.shared])).toEqual([
      ["@acme/shared", "unsynced", true],
      ["@acme/gpu-only", "failed", undefined],
    ]);
  });
});

describe("a plugin the running build cannot fully run", () => {
  const view: PluginView = { machineId: SELF, remote: null };
  const here = { everywhere: true, machines: [], here: true };
  const states = (plugins: InstalledPluginsResponse["plugins"]) =>
    modules(installedPluginRows([], "en", { ...deployment, plugins }, [], view)).map((r) => [
      r.specifier,
      r.state,
      r.unsatisfied,
    ]);

  it("is disabled, with the build's reason — not waiting for a restart", () => {
    const unmet = {
      ...row("@acme/unmet", here, false),
      unsatisfied: { disabled: true, reason: "names interface 'Nope'" },
    };
    expect(states([unmet])).toEqual([["@acme/unmet", "disabled", "names interface 'Nope'"]]);
    const facets = rowFacets(
      installedPluginRows([], "en", { ...deployment, plugins: [unmet] }, [], view)[0]!,
    );
    expect(facets.states).toEqual(["installed", "incompatible"]);
  });

  it("still runs when only a contribution has no slot, and carries the reason", () => {
    const partial = {
      ...row("@acme/partial", here, true),
      unsatisfied: { disabled: false, reason: "contributes to 'nowhere.slot'" },
    };
    expect(states([partial])).toEqual([
      ["@acme/partial", "active", "contributes to 'nowhere.slot'"],
    ]);
    // Found by the same filter as a disabled one: both are what the build cannot fully run.
    const facets = rowFacets(
      installedPluginRows([], "en", { ...deployment, plugins: [partial] }, [], view)[0]!,
    );
    expect(facets.states).toEqual(["installed", "running", "incompatible"]);
  });

  it("on another machine, reads that machine's own report", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [
        {
          ...row("@acme/gpu-only", here, false),
          unsatisfied: { disabled: true, reason: "names interface 'Nope'" },
        },
      ],
    };
    const rows = modules(installedPluginRows([], "en", deployment, [], { machineId: GPU, remote }));
    expect(rows.find((r) => r.specifier === "@acme/gpu-only")).toMatchObject({
      state: "disabled",
      unsatisfied: "names interface 'Nope'",
    });
  });
});

const skill = (name: string) => ({ name, description: "", version: "2026.08.01.1" });

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
      { plan: "2026.08.01.1", run: "2026.08.01.1" },
      { orchestration: "2026.08.01.1" },
    );
    expect(pluginInstalled(FULL, whole)).toBe(true);
    // An older version that shipped one skill fewer, or a copy missing its hook package, is
    // what the server lists as behind: an installed plugin an update completes.
    expect(
      pluginInstalled(FULL, installs({ plan: "2026.08.01.1" }, { orchestration: "2026.08.01.1" })),
    ).toBe(true);
    expect(pluginInstalled(FULL, installs({ plan: "2026.08.01.1", run: "2026.08.01.1" }, {}))).toBe(
      true,
    );
    expect(pluginInstalled(FULL, installs({ other: "2026.08.01.1" }, {}))).toBe(false);
  });

  it("reads a skill-only plugin off the skills list and a hook-only one off the hooks list", () => {
    expect(pluginInstalled(SKILL_ONLY, installs({ "web-design": "2026.07.30.1" }, {}))).toBe(true);
    expect(pluginInstalled(SKILL_ONLY, installs({}, { "web-design": "2026.07.30.1" }))).toBe(false);
    expect(pluginInstalled(HOOK_ONLY, installs({}, { goal: "2026.08.29.1" }))).toBe(true);
    expect(pluginInstalled(HOOK_ONLY, installs({ goal: "2026.08.29.1" }, {}))).toBe(false);
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
        installs({ plan: "2026.07.01.1", run: "2026.07.01.1" }, { orchestration: "2026.07.02.1" }),
      ),
    ).toBe("2026.07.02.1");
    expect(installedPluginVersion(SKILL_ONLY, installs({ "web-design": "2026.07.30.1" }, {}))).toBe(
      "2026.07.30.1",
    );
  });

  it("is undefined where the plugin is not installed, and reads a partial copy's first installed skill", () => {
    expect(installedPluginVersion(SKILL_ONLY, undefined)).toBeUndefined();
    expect(
      installedPluginVersion(SKILL_ONLY, installs({ other: "2026.07.01.1" }, {})),
    ).toBeUndefined();
    expect(
      installedPluginVersion(
        { name: "pair", skills: [skill("plan"), skill("run")], hooks: [] },
        installs({ run: "2026.07.01.1" }, {}),
      ),
    ).toBe("2026.07.01.1");
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
      agent("stale", { name: "web-design", version: "2026.08.01.1" }),
      agent("current"),
      agent("other", { name: "vllm", version: "2026.08.01.1" }),
      agent(
        "also_stale",
        { name: "web-design", version: "2026.08.01.1" },
        { name: "vllm", version: "2026.08.01.1" },
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
          { name: "web-design", version: "2026.08.01.3" },
          { name: "vllm", version: "2026.08.01.2" },
        ),
        agent("beta"),
        agent("gamma", { name: "web-design", version: "2026.08.01.3" }),
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
      agent("alpha", { name: "shared", version: "2026.08.01.2" }),
      agent("beta", { name: "shared", version: "2026.08.01.2" }),
      agent("gamma", { name: "shared", version: "2026.08.01.2" }),
    ]);
    expect(plan.plugins).toEqual(["shared"]);
    expect(plan.perAgent).toHaveLength(3);
  });
});

describe("module plugin versions and platforms", () => {
  it("an installed row carries the version on that machine's disk, not the registry's", () => {
    const onDisk: InstalledPluginsResponse = {
      ...deployment,
      plugins: [
        {
          ...row("@acme/shared", { everywhere: true, machines: [], here: true }),
          version: "0.2.2",
        },
      ],
    };
    const view: PluginView = { machineId: SELF, remote: null };
    // The registry lists 0.2.3; the copy this server resolves and runs is 0.2.2, and that is
    // what the row states.
    const rows = modules(installedPluginRows([], "en", onDisk, [entry("@acme/shared")], view));
    expect(rows.map((r) => [r.specifier, r.version])).toEqual([["@acme/shared", "0.2.2"]]);
  });

  it("another machine's row carries the version that machine's own answer states", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [
        {
          ...row("@acme/gpu-only", { everywhere: false, machines: [GPU], here: true }),
          version: "0.2.4",
        },
      ],
    };
    const rows = modules(installedPluginRows([], "en", deployment, [], { machineId: GPU, remote }));
    expect(rows.map((r) => [r.specifier, r.version])).toEqual([
      ["@acme/shared", undefined],
      ["@acme/gpu-only", "0.2.4"],
    ]);
  });

  it("marks an entry for another platform, keeps it, and sorts it after the rest", () => {
    const view: PluginView = { machineId: SELF, remote: null };
    const linux = { ...deployment, plugins: [], platform: "linux" };
    const index = [entry("@acme/m", ["darwin"]), entry("@acme/a"), entry("@acme/t", ["linux"])];
    expect(
      availablePluginRows(linux, index, view).map((r) => [r.specifier, r.otherPlatform]),
    ).toEqual([
      ["@acme/a", undefined],
      ["@acme/t", undefined],
      ["@acme/m", ["darwin"]],
    ]);
  });

  it("judges the platform by the machine in view, and not at all when it is not known", () => {
    const index = [entry("@acme/mac", ["darwin"])];
    const linux = { ...deployment, plugins: [], platform: "linux" };
    // The machine in view is a mac: not for another platform there.
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [],
      platform: "darwin",
    };
    const there: PluginView = { machineId: GPU, remote };
    expect(availablePluginRows(linux, index, there)[0]!.otherPlatform).toBeUndefined();
    // A server that predates `platform` does not say: offered as before.
    const old = { ...deployment, plugins: [] };
    expect(availablePluginRows(old, index)[0]!.otherPlatform).toBeUndefined();
  });
});
