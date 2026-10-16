/**
 * The Plugins page's pure decisions: its rows, how they are grouped and searched, and the
 * update-everything plan (features/plugins/plugin-groups.ts, plugins-page.tsx).
 *
 * - All machines: every module is listed, and a machine-only one says where it runs. This
 *   server: what it is asked for, a shared module not removable from its table. Another
 *   machine: the state that machine reports, and what it has not received yet.
 * - Every plugin is one row: a library plugin and the module published as its package are one;
 *   a module sits under the first category of its entry the page knows, else Other.
 * - Rows are grouped by category until the reader picks another grouping — in the categories'
 *   order, Agent Sandbox after the library's and Other last — and the same rows regroup by
 *   status (what wants a look first), by contents, or into one untitled section. The grouping
 *   and the folded sections are remembered per browser; nothing usable stored reads as
 *   category with nothing folded.
 * - The search box narrows the rows to those whose names, descriptions (in either language) or
 *   keywords hold the query, whatever its case; a query nothing holds leaves none. A plugin's
 *   display name, in either language, finds it too, and so do its MCP servers' names and
 *   targets.
 * - Grouped by contents, a plugin of MCP servers alone sits under MCP servers; one that also
 *   ships Skills stays with the Skills.
 * - The "update all" plan is empty when no Agent is behind, sends one request per Agent with
 *   every plugin it is behind on, and counts distinct plugins as the notice does.
 * - The incompatible-only filter is off until this browser turns it on, and a flip reaches every
 *   reader at once — the Settings switch and the page under it.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import {
  foldKey,
  groupRows,
  initialFoldedGroups,
  initialPluginsGroupBy,
  moduleParts,
  pluginCategories,
  pluginRows,
  rowMatches,
  storeFoldedGroups,
  storePluginsGroupBy,
  type PluginRow,
  type PluginView,
} from "../src/features/plugins/plugin-groups";
import { pluginStatus, type PluginStatus } from "../src/features/plugins/plugin-status";
import {
  PLUGINS_INCOMPATIBLE_ONLY_KEY,
  readPluginsIncompatibleOnly,
  subscribePluginsIncompatibleOnly,
  writePluginsIncompatibleOnly,
} from "../src/features/plugins/incompatible-only";
import { pluginUpdatePlan } from "../src/features/plugins/plugins-page";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

beforeEach(() => {
  setActiveStrings(en);
});

const SELF = "Self000000000000";
const GPU = "Gpu0000000000000";

const listed = (
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
    listed("@acme/shared", { everywhere: true, machines: [], here: true }),
    listed("@acme/gpu-only", { everywhere: false, machines: [GPU], here: false }),
    listed("@acme/self-only", { everywhere: false, machines: [SELF], here: true }),
  ],
  shipped: [],
  file: ".project_config.toml",
  machineId: SELF,
  restartPending: false,
};

describe("server modules per machine", () => {
  it("this server: shared and own rows, with only its own rows removable", () => {
    const parts = moduleParts(deployment, [], { machineId: SELF, remote: null });
    expect(parts.map((m) => [m.specifier, m.state, m.shared])).toEqual([
      ["@acme/shared", "active", true],
      ["@acme/self-only", "active", undefined],
    ]);
    expect(parts[0]!.removeBlocked).toBe(en.plugins.sharedHint);
    expect(parts[1]!.removeBlocked).toBeUndefined();
    expect(
      moduleParts({ ...deployment, shipped: ["@acme/gpu-only"] }, []).filter(
        (m) => m.state === "none",
      ),
    ).toEqual([expect.objectContaining({ specifier: "@acme/gpu-only", state: "none" })]);
  });

  it("a package pinned in both tables is one shared read-only row", () => {
    const both = {
      ...deployment,
      plugins: [listed("@acme/shared", { everywhere: true, machines: [SELF], here: true })],
    };
    const parts = moduleParts(both, [], { machineId: SELF, remote: null });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      specifier: "@acme/shared",
      state: "active",
      shared: true,
      removeBlocked: en.plugins.sharedHint,
    });
  });

  it("does not use another machine's response as the selected machine's state", () => {
    const view: PluginView = { machineId: GPU, remote: deployment };
    expect(moduleParts(deployment, [], view).map((m) => [m.specifier, m.state])).toEqual([
      ["@acme/shared", "unsynced"],
      ["@acme/gpu-only", "unsynced"],
    ]);
  });

  it("does not offer this machine's failed plugin again", () => {
    const failing = {
      ...deployment,
      plugins: [{ ...deployment.plugins[2]!, active: false, error: "load failed" }],
      shipped: ["@acme/self-only"],
    };
    expect(moduleParts(failing, []).map((m) => [m.specifier, m.state, m.shared])).toEqual([
      ["@acme/self-only", "failed", undefined],
    ]);
  });

  it("another machine: the state it reports, and what it has not received yet", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [listed("@acme/gpu-only", { everywhere: true, machines: [], here: true }, false)],
    };
    remote.plugins[0]!.error = "npm: 404";
    const view: PluginView = { machineId: GPU, remote };
    expect(
      moduleParts(deployment, [], view).map((m) => [
        m.specifier,
        m.state,
        m.removeBlocked === undefined,
      ]),
    ).toEqual([
      ["@acme/shared", "unsynced", false],
      ["@acme/gpu-only", "failed", true],
    ]);
  });

  it("offers what the index lists and the build ships that the Project does not ask for", () => {
    const entry = (name: string): PluginIndexEntry => ({
      name,
      version: "0.2.3",
      description: name,
      authors: [],
      license: "Apache-2.0",
    });
    const parts = moduleParts({ ...deployment, shipped: ["@penguinharness/sandbox-dsh"] }, [
      entry("@acme/shared"),
      entry("@penguinharness/sandbox-bwrap"),
    ]);
    expect(parts.filter((m) => m.state === "none").map((m) => [m.specifier, m.shipped])).toEqual([
      ["@penguinharness/sandbox-bwrap", false],
      ["@penguinharness/sandbox-dsh", true],
    ]);
  });
});

const plugin = (name: string, extra: Partial<PluginItem> = {}): PluginItem => ({
  name,
  description: `${name}.`,
  version: "0.2.13",
  package: `@penguinharness/${name}`,
  source: "builtin",
  skills: [{ name, description: "", version: "2026.10.04.1" }],
  hooks: [],
  mcpServers: [],
  ...extra,
});

const GROUPS: PluginGroupItem[] = [
  {
    id: "office-productivity",
    title: "Office Productivity",
    titleZh: "办公效率",
    plugins: [
      plugin("goal", {
        title: "Goal Mode",
        titleZh: "目标模式",
        skills: [],
        hooks: ["stop"],
        hookVersion: "2026.10.04.1",
      }),
    ],
  },
  {
    id: "software-development",
    title: "Software Development",
    plugins: [plugin("software-development")],
  },
  { id: "other", title: "Other", titleZh: "其他", plugins: [plugin("mystery")] },
];

const sandbox = (name: string, categories: string[]): PluginIndexEntry => ({
  name,
  version: "0.2.3",
  description: `${name} backend`,
  descriptionZh: `${name} 后端`,
  authors: ["Prism Shadow"],
  license: "Apache-2.0",
  keywords: ["linux"],
  categories,
});

describe("the page's rows", () => {
  it("makes one row of a library plugin and the module published as its package", () => {
    const rows = pluginRows(
      [{ id: "software-development", title: "Software Development", plugins: [plugin("both")] }],
      [{ specifier: "@penguinharness/both", entry: undefined, state: "active", shipped: true }],
    );
    expect(rows.map((r) => [r.key, r.category, r.library?.name, r.module?.state])).toEqual([
      ["library:both", "software-development", "both", "active"],
    ]);
  });

  it("joins a package an admin installed with its library plugin by the package's own name", () => {
    const rows = pluginRows(
      [
        {
          id: "other",
          title: "Other",
          plugins: [plugin("notes", { package: "@acme/notes", source: "installed" })],
        },
      ],
      [{ specifier: "@acme/notes", entry: undefined, state: "active", shipped: false }],
    );
    expect(rows.map((r) => [r.key, r.library?.package, r.module?.specifier])).toEqual([
      ["library:notes", "@acme/notes", "@acme/notes"],
    ]);
  });

  it("files a module under the first category of its entry the page knows, and under Other otherwise", () => {
    const rows = pluginRows(GROUPS, [
      {
        specifier: "@penguinharness/sandbox-bwrap",
        entry: sandbox("bwrap", ["linux", "sandbox"]),
        state: "none",
        shipped: true,
      },
      {
        specifier: "@acme/feishu",
        entry: sandbox("feishu", ["messaging"]),
        state: "none",
        shipped: false,
      },
      { specifier: "@acme/bare", entry: undefined, state: "none", shipped: true },
    ]);
    expect(rows.filter((r) => r.module).map((r) => [r.name, r.category])).toEqual([
      ["sandbox-bwrap", "sandbox"],
      ["feishu", "other"],
      ["bare", "other"],
    ]);
  });
});

/** The page's rows for the grouping and filter scenarios, with their statuses fixed. */
function pageRows(): { rows: PluginRow[]; statusOf: (row: PluginRow) => PluginStatus } {
  const rows = pluginRows(GROUPS, [
    {
      specifier: "@penguinharness/sandbox-bwrap",
      entry: sandbox("bwrap", ["sandbox"]),
      state: "active",
      shipped: true,
    },
    {
      specifier: "@penguinharness/sandbox-wsl",
      entry: sandbox("wsl", ["sandbox"]),
      state: "none",
      shipped: true,
    },
  ]);
  const statuses: Record<string, PluginStatus> = {
    "library:goal": "update",
    "library:software-development": "installed",
    "library:mystery": "available",
  };
  const statusOf = (row: PluginRow) => statuses[row.key] ?? pluginStatus(row, null);
  return { rows, statusOf };
}

const titles = (groups: ReturnType<typeof groupRows>) =>
  groups.map((g) => [g.title, g.rows.map((r) => r.name)]);

describe("grouping", () => {
  it("groups by category unless told otherwise: the library's in order, then Agent Sandbox, then Other", () => {
    expect(initialPluginsGroupBy(memoryStorage())).toBe("category");
    const { rows, statusOf } = pageRows();
    const categories = pluginCategories(GROUPS, "en");
    expect(titles(groupRows(rows, statusOf, "category", categories))).toEqual([
      ["Office Productivity", ["goal"]],
      ["Software Development", ["software-development"]],
      ["Agent Sandbox", ["sandbox-bwrap", "sandbox-wsl"]],
      ["Other", ["mystery"]],
    ]);
    expect(pluginCategories(GROUPS, "zh").map((c) => c.title)).toContain("办公效率");
  });

  it("regroups the same rows by status, what wants a look first, by contents, or into one section", () => {
    const { rows, statusOf } = pageRows();
    const categories = pluginCategories(GROUPS, "en");
    expect(titles(groupRows(rows, statusOf, "status", categories))).toEqual([
      ["Update available", ["goal"]],
      ["Installed", ["sandbox-bwrap", "software-development"]],
      ["Available", ["mystery", "sandbox-wsl"]],
    ]);
    expect(titles(groupRows(rows, statusOf, "kind", categories))).toEqual([
      ["Skills", ["mystery", "software-development"]],
      ["Hooks", ["goal"]],
      ["Server modules", ["sandbox-bwrap", "sandbox-wsl"]],
    ]);
    const none = groupRows(rows, statusOf, "none", categories);
    expect(none).toHaveLength(1);
    expect(none[0]!.rows).toHaveLength(rows.length);
  });

  it("remembers the grouping and the folded sections in this browser, and survives storage it cannot use", () => {
    const storage = memoryStorage();
    storePluginsGroupBy("status", storage);
    storeFoldedGroups(new Set([foldKey("category", "sandbox")]), storage);
    expect(initialPluginsGroupBy(storage)).toBe("status");
    expect([...initialFoldedGroups(storage)]).toEqual(["category:sandbox"]);

    const garbage = memoryStorage();
    garbage.setItem("penguin.pluginsGroupBy", "by-color");
    garbage.setItem("penguin.pluginsGroupsFolded", "{not json");
    expect(initialPluginsGroupBy(garbage)).toBe("category");
    expect(initialFoldedGroups(garbage).size).toBe(0);
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => storePluginsGroupBy("kind", blocked)).not.toThrow();
    expect(initialPluginsGroupBy(blocked)).toBe("category");
  });
});

describe("search", () => {
  it("narrows the rows to the names, descriptions in either language and keywords that hold the query", () => {
    const { rows } = pageRows();
    const keep = (query: string) => rows.filter((row) => rowMatches(row, query)).map((r) => r.name);
    expect(keep("")).toHaveLength(rows.length);
    expect(keep("wsl 后端")).toEqual(["sandbox-wsl"]);
    expect(keep("LINUX")).toEqual(["sandbox-bwrap", "sandbox-wsl"]);
    expect(keep("mystery")).toEqual(["mystery"]);
    expect(keep("no plugin says this")).toEqual([]);
  });

  it("finds a plugin by its display name in either language", () => {
    const { rows } = pageRows();
    const keep = (query: string) => rows.filter((row) => rowMatches(row, query)).map((r) => r.name);
    expect(keep("goal mode")).toEqual(["goal"]);
    expect(keep("目标")).toEqual(["goal"]);
  });
});

describe("a plugin of MCP servers", () => {
  const server = (name: string, target: string) => ({
    name,
    transport: "http" as const,
    target,
    setup: [],
    oauth: true,
    signIn: true,
  });
  const rows = pluginRows(
    [
      {
        id: "other",
        title: "Other",
        plugins: [
          plugin("gmail", {
            skills: [],
            mcpServers: [server("gmail", "https://gmailmcp.googleapis.com/mcp/v1")],
          }),
          plugin("cloudflare", {
            mcpServers: [server("cloudflare-api", "https://mcp.cloudflare.com/mcp")],
          }),
        ],
      },
    ],
    [],
  );

  it("sits under MCP servers when it carries nothing else, and with the Skills when it ships some", () => {
    const groups = groupRows(rows, () => "available", "kind", pluginCategories([], "en"));
    expect(titles(groups)).toEqual([
      ["Skills", ["cloudflare"]],
      ["MCP servers", ["gmail"]],
    ]);
  });

  it("is found by its servers' names and targets", () => {
    const keep = (query: string) => rows.filter((row) => rowMatches(row, query)).map((r) => r.name);
    expect(keep("gmailmcp")).toEqual(["gmail"]);
    expect(keep("cloudflare-api")).toEqual(["cloudflare"]);
  });
});

/** Just the two fields the update questions read (they take a Pick, so the fixture can be one too). */
const agent = (agentId: string, ...updates: Array<{ name: string; version: string }>) => ({
  agentId,
  pluginUpdates: updates,
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

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

describe("the incompatible-only filter", () => {
  it("is off until this browser turns it on, and survives storage it cannot use", () => {
    const storage = memoryStorage();
    expect(readPluginsIncompatibleOnly(storage)).toBe(false);
    writePluginsIncompatibleOnly(true, storage);
    expect(readPluginsIncompatibleOnly(storage)).toBe(true);
    writePluginsIncompatibleOnly(false, storage);
    expect(readPluginsIncompatibleOnly(storage)).toBe(false);

    const garbage = memoryStorage();
    garbage.setItem(PLUGINS_INCOMPATIBLE_ONLY_KEY, "true");
    expect(readPluginsIncompatibleOnly(garbage)).toBe(false);
    const blocked = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => writePluginsIncompatibleOnly(true, blocked)).not.toThrow();
    expect(readPluginsIncompatibleOnly(blocked)).toBe(false);
  });

  it("reaches every reader the moment it flips", () => {
    const seen: boolean[] = [];
    const stop = subscribePluginsIncompatibleOnly(() => seen.push(readPluginsIncompatibleOnly()));
    try {
      writePluginsIncompatibleOnly(true);
      writePluginsIncompatibleOnly(false);
    } finally {
      stop();
    }
    expect(seen).toEqual([true, false]);
  });
});

describe("a plugin the running build cannot fully run", () => {
  const view: PluginView = { machineId: SELF, remote: null };
  const here = { everywhere: true, machines: [], here: true };

  it("is disabled with its reason, not waiting for a restart", () => {
    const unmet = {
      ...listed("@acme/unmet", here, false),
      unsatisfied: { disabled: true, reason: "names interface Nope" },
    };
    const parts = moduleParts({ ...deployment, plugins: [unmet] }, [], view);
    expect(parts[0]).toMatchObject({ state: "disabled", unsatisfied: "names interface Nope" });
    expect(pluginStatus({ module: parts[0]! }, null)).toBe("incompatible");
  });

  it("keeps a partial plugin running and carries the reason", () => {
    const partial = {
      ...listed("@acme/partial", here, true),
      unsatisfied: { disabled: false, reason: "contributes to nowhere.slot" },
    };
    const parts = moduleParts({ ...deployment, plugins: [partial] }, [], view);
    expect(parts[0]).toMatchObject({ state: "active", unsatisfied: "contributes to nowhere.slot" });
    expect(pluginStatus({ module: parts[0]! }, null)).toBe("installed");
  });

  it("reads another machine's own report", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [
        {
          ...listed("@acme/gpu-only", here, false),
          unsatisfied: { disabled: true, reason: "names interface Nope" },
        },
      ],
    };
    const parts = moduleParts(deployment, [], { machineId: GPU, remote });
    expect(parts.find((m) => m.specifier === "@acme/gpu-only")).toMatchObject({
      state: "disabled",
      unsatisfied: "names interface Nope",
    });
  });
});

/** One registry entry, as the merged index would list it — optionally for one platform only. */
const entry = (name: string, os?: string[]): PluginIndexEntry => ({
  name,
  version: "0.2.3",
  description: `${name}, as the registry describes it`,
  authors: [],
  license: "MIT",
  ...(os === undefined ? {} : { os }),
});

describe("module plugin versions and platforms", () => {
  it("an installed row carries the version on that machine's disk, not the registry's", () => {
    const onDisk: InstalledPluginsResponse = {
      ...deployment,
      plugins: [
        {
          ...listed("@acme/shared", { everywhere: true, machines: [], here: true }),
          version: "0.2.2",
        },
      ],
    };
    const view: PluginView = { machineId: SELF, remote: null };
    // The registry lists 0.2.3; the copy this server resolves and runs is 0.2.2, and that is
    // what the row states.
    const rows = moduleParts(onDisk, [entry("@acme/shared")], view);
    expect(rows.map((r) => [r.specifier, r.version])).toEqual([["@acme/shared", "0.2.2"]]);
  });

  it("another machine's row carries the version that machine's own answer states", () => {
    const remote: InstalledPluginsResponse = {
      ...deployment,
      machineId: GPU,
      plugins: [
        {
          ...listed("@acme/gpu-only", { everywhere: false, machines: [GPU], here: true }),
          version: "0.2.4",
        },
      ],
    };
    const rows = moduleParts(deployment, [], { machineId: GPU, remote });
    expect(rows.map((r) => [r.specifier, r.version])).toEqual([
      ["@acme/shared", undefined],
      ["@acme/gpu-only", "0.2.4"],
    ]);
  });

  it("marks an entry for another platform, keeps it, and sorts it after the rest", () => {
    const view: PluginView = { machineId: SELF, remote: null };
    const linux = { ...deployment, plugins: [], platform: "linux" };
    const index = [entry("@acme/m", ["darwin"]), entry("@acme/a"), entry("@acme/t", ["linux"])];
    expect(moduleParts(linux, index, view).map((r) => [r.specifier, r.otherPlatform])).toEqual([
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
    expect(moduleParts(linux, index, there)[0]!.otherPlatform).toBeUndefined();
    // A server that predates `platform` does not say: offered as before.
    const old = { ...deployment, plugins: [] };
    expect(moduleParts(old, index)[0]!.otherPlatform).toBeUndefined();
  });
});
