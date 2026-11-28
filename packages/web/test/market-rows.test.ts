/**
 * The plugin market across machines (library/plugin/src/web/market-rows.ts): which rows the page
 * shows for the header's choice, and where each row's actions go.
 *
 * A machine's server modules:
 * - A module the Project lists for that machine alone is that machine's to remove, though the
 *   machine itself holds it in its shared table (the fleet sync put it there).
 * - A module the Project lists for every machine is shared, and its Remove says why it is not
 *   this page's to make.
 * - A module the Project lists for the machine that it does not run yet reads as not synced.
 * - A module the machine runs that no table of the Project lists is offered to install, not to
 *   remove; one its own index offers is the machine's to install.
 *
 * "All machines":
 * - A machine's row that says what this server's card says is folded into it.
 * - A machine's row is kept for a package this server does not list, a library plugin of
 *   another version, or a module in another state there.
 *
 * The header's choice: this server's rows alone, one machine's rows, or — for a machine whose
 * market is not read — the modules the tables list for it, in the state it reported.
 *
 * Where a row's actions go:
 * - This server's card offers every Agent; a machine's card that machine's Agents.
 * - The Agent of a one-step install: the current Agent for this server's card; for a machine's,
 *   a connected Agent with the whole plugin, else its default Agent, else its first; none when
 *   no Agent of it is connected.
 * - A module write is listed for the machine the row came from, else the machine in view.
 * - A machine out of reach holds its Agent installs, not its module writes; another module write
 *   running holds every other module's.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  AgentSummary,
  InstalledPluginsResponse,
  PluginGroupItem,
  PluginIndexEntry,
  PluginItem,
} from "@prismshadow/penguin-server/api";
import {
  combinedMarketRows,
  machineRows,
  marketRows,
  moduleTarget,
  rowBlocked,
  rowCurrentTarget,
  rowTargets,
  type MachineMarketData,
} from "@prismshadow/penguin-library-plugin/web/market-rows";
import type { InstallTarget } from "@prismshadow/penguin-library-plugin/web/plugin-card";
import type { PluginRow } from "@prismshadow/penguin-library-plugin/web/plugin-groups";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

beforeEach(() => setActiveStrings(en));

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

const response = (
  machineId: string,
  plugins: InstalledPluginsResponse["plugins"],
): InstalledPluginsResponse => ({
  machineId,
  plugins,
  shipped: [],
  file: ".project_config.toml",
  restartPending: false,
});

/** This server's Project tables: one module for every machine, one for the GPU box only. */
const TABLES = response(SELF, [
  listed("@acme/shared", { everywhere: true, machines: [], here: true }),
  listed("@acme/gpu-only", { everywhere: false, machines: [GPU], here: false }),
]);

/** What the GPU box reports it runs: the list the fleet sync handed it, as its shared table. */
const GPU_RUNS = response(GPU, [
  listed("@acme/shared", { everywhere: true, machines: [], here: true }),
  listed("@acme/gpu-only", { everywhere: true, machines: [], here: true }),
]);

const entry = (name: string, version = "1.0.0"): PluginIndexEntry => ({
  name,
  version,
  description: `${name}.`,
  authors: [],
  license: "MIT",
});

const plugin = (name: string, version = "0.2.13"): PluginItem => ({
  name,
  description: `${name}.`,
  version,
  package: `@penguinharness/${name}`,
  source: "builtin",
  skills: [{ name, description: "", version: "1" }],
  hooks: [],
  mcpServers: [],
});

const library = (...plugins: PluginItem[]): PluginGroupItem[] => [
  { id: "tools", title: "Tools", plugins },
];

const gpu = (over: Partial<MachineMarketData> = {}): MachineMarketData => ({
  machineId: GPU,
  label: "gpu-box",
  library: library(),
  index: [],
  running: GPU_RUNS,
  libraryLive: true,
  indexLive: true,
  runningLive: true,
  ...over,
});

const moduleOf = (rows: PluginRow[], specifier: string) =>
  rows.find((row) => row.module?.specifier === specifier)?.module;

describe("a machine's server modules", () => {
  it("lets the Project remove a module it lists for that machine alone, though the machine shares it", () => {
    const gpuOnly = moduleOf(machineRows(gpu(), TABLES), "@acme/gpu-only");
    expect(gpuOnly).toMatchObject({ state: "active" });
    expect(gpuOnly?.shared).toBeUndefined();
    expect(gpuOnly?.removeBlocked).toBeUndefined();
  });

  it("keeps a module the Project lists for every machine shared, with the reason Remove is not here", () => {
    const shared = moduleOf(machineRows(gpu(), TABLES), "@acme/shared");
    expect(shared).toMatchObject({ shared: true, removeBlocked: en.plugins.sharedHint });
  });

  it("reads a module the Project lists for the machine as not synced until the machine runs it", () => {
    const rows = machineRows(gpu({ running: response(GPU, []) }), TABLES);
    expect(moduleOf(rows, "@acme/gpu-only")?.state).toBe("unsynced");
  });

  it("offers to install what the machine runs on its own, and what its own index offers", () => {
    const own = response(GPU, [
      listed("@acme/local", { everywhere: false, machines: [GPU], here: true }),
    ]);
    const rows = machineRows(
      gpu({ running: own, index: [entry("@acme/local"), entry("@acme/gpu-tool")] }),
      TABLES,
    );
    expect(moduleOf(rows, "@acme/local")?.state).toBe("none");
    expect(moduleOf(rows, "@acme/gpu-tool")?.state).toBe("none");
    expect(rows.find((row) => row.module?.specifier === "@acme/gpu-tool")).toMatchObject({
      key: `${GPU}/module:@acme/gpu-tool`,
      origin: { machineId: GPU, label: "gpu-box", live: true },
    });
  });

  it("marks a machine's row live only while what it stands on is the machine's word now", () => {
    const rows = machineRows(
      gpu({ library: library(plugin("charts")), libraryLive: false, index: [entry("@acme/x")] }),
      TABLES,
    );
    expect(rows.find((row) => row.name === "charts")?.origin?.live).toBe(false);
    expect(rows.find((row) => row.module?.specifier === "@acme/x")?.origin?.live).toBe(true);
  });
});

describe("All machines", () => {
  const here = (...rows: PluginRow[]) => rows;
  const libraryRow = (p: PluginItem, origin?: PluginRow["origin"]): PluginRow => ({
    key: `library:${p.name}`,
    name: p.name,
    category: "tools",
    library: p,
    ...(origin ? { origin } : {}),
  });
  const ORIGIN = { machineId: GPU, label: "gpu-box", live: true };

  it("folds a machine's row that says what this server's card says", () => {
    const rows = combinedMarketRows(here(libraryRow(plugin("charts"))), [
      [libraryRow(plugin("charts"), ORIGIN)],
    ]);
    expect(rows.map((row) => row.origin?.label ?? "here")).toEqual(["here"]);
  });

  it("keeps a machine's row for a package this server lacks, or of another version", () => {
    const rows = combinedMarketRows(here(libraryRow(plugin("charts"))), [
      [libraryRow(plugin("charts", "0.3.0"), ORIGIN), libraryRow(plugin("notes"), ORIGIN)],
    ]);
    expect(rows.map((row) => `${row.name}@${row.origin?.label ?? "here"}`)).toEqual([
      "charts@here",
      "charts@gpu-box",
      "notes@gpu-box",
    ]);
  });

  it("keeps a machine's module in another state, and folds one it does not have either", () => {
    const local = machineRowsHere();
    const machine = machineRows(gpu({ index: [entry("@acme/idle")] }), TABLES);
    const rows = combinedMarketRows(local, [machine]);
    const where = (specifier: string) =>
      rows
        .filter((row) => row.module?.specifier === specifier)
        .map((row) => `${row.module!.state}@${row.origin?.label ?? "here"}`);
    // This server does not run it; the GPU box does, as the Project asks of it.
    expect(where("@acme/gpu-only")).toEqual(["none@here", "active@gpu-box"]);
    expect(where("@acme/shared")).toEqual(["active@here"]);
    expect(where("@acme/idle")).toEqual(["none@here"]);
  });

  /** This server's rows over the same tables, with the GPU box's packages in its index too. */
  function machineRowsHere() {
    return marketRows(
      { all: false, machineId: SELF },
      { groups: [], tables: TABLES, index: [entry("@acme/gpu-only"), entry("@acme/idle")] },
      [],
      null,
    );
  }
});

describe("the header's choice", () => {
  const local = { groups: library(plugin("charts")), tables: TABLES, index: [] };

  it("shows this server's rows alone, also before its id is read", () => {
    for (const machineId of [SELF, undefined]) {
      const rows = marketRows({ all: false, machineId }, local, [gpu()], null);
      expect(rows.every((row) => row.origin === undefined)).toBe(true);
      expect(rows.map((row) => row.name)).toContain("charts");
    }
  });

  it("shows one machine's own rows", () => {
    const rows = marketRows({ all: false, machineId: GPU }, local, [gpu()], null);
    expect(rows.every((row) => row.origin?.machineId === GPU)).toBe(true);
    expect(rows.map((row) => row.name)).not.toContain("charts");
  });

  it("shows a machine without a market the modules the tables list for it, as it reported them", () => {
    const rows = marketRows({ all: false, machineId: GPU }, local, [], GPU_RUNS);
    expect(
      rows.map((row) => [row.module?.specifier, row.module?.state, row.module?.shared]),
    ).toEqual([
      ["@acme/shared", "active", true],
      ["@acme/gpu-only", "active", undefined],
    ]);
  });
});

describe("where a row's actions go", () => {
  const agent = (agentId: string) => ({ agentId }) as AgentSummary;
  const at = (agentId: string, machine: string | null, live = true): InstallTarget => ({
    key: machine === null ? agentId : `${machine}/${agentId}`,
    agent: agent(agentId),
    machine: machine === null ? null : { machineId: machine, label: machine, live },
  });
  const TARGETS = [
    at("default_agent", null),
    at("helper", null),
    at("helper", GPU),
    at("default_agent", GPU),
  ];
  const hereRow: PluginRow = {
    key: "library:charts",
    name: "charts",
    category: "tools",
    library: plugin("charts"),
  };
  const gpuRow = (live = true): PluginRow => ({
    ...hereRow,
    key: `${GPU}/library:charts`,
    origin: { machineId: GPU, label: "gpu-box", live },
  });
  const keys = (targets: readonly InstallTarget[]) => targets.map((t) => t.key);
  const keyOf = (target: InstallTarget | undefined) => target?.key;

  it("offers every Agent on this server's card, and that machine's on a machine's", () => {
    expect(keys(rowTargets(hereRow, TARGETS))).toEqual(TARGETS.map((t) => t.key));
    expect(keys(rowTargets(gpuRow(), TARGETS))).toEqual([`${GPU}/helper`, `${GPU}/default_agent`]);
  });

  it("installs in one step on the current Agent here, and on a fitting connected Agent of the machine", () => {
    expect(keyOf(rowCurrentTarget(hereRow, TARGETS, "helper", () => false))).toBe("helper");
    const gpuTargets = rowTargets(gpuRow(), TARGETS);
    expect(
      keyOf(rowCurrentTarget(gpuRow(), gpuTargets, "helper", (t) => t.agent.agentId === "helper")),
    ).toBe(`${GPU}/helper`);
    expect(keyOf(rowCurrentTarget(gpuRow(), gpuTargets, "helper", () => false))).toBe(
      `${GPU}/default_agent`,
    );
    const away = [at("helper", GPU, false)];
    expect(rowCurrentTarget(gpuRow(), away, "helper", () => true)).toBeUndefined();
  });

  it("lists a module write for the machine the row came from, else the machine in view", () => {
    const moduleRow: PluginRow = {
      key: "module:@acme/x",
      name: "x",
      category: "other",
      module: { specifier: "@acme/x", entry: undefined, state: "none", shipped: false },
    };
    expect(moduleTarget(moduleRow, SELF)).toBe(SELF);
    expect(
      moduleTarget(
        { ...moduleRow, origin: { machineId: GPU, label: "gpu-box", live: false } },
        SELF,
      ),
    ).toBe(GPU);
  });

  it("holds a machine's Agent installs while it is out of reach, never its module writes", () => {
    const module = {
      specifier: "@acme/x",
      entry: undefined,
      state: "none" as const,
      shipped: false,
    };
    const away = { machineId: GPU, label: "gpu-box", live: false };
    expect(rowBlocked(gpuRow(false), SELF, null)).toBe(true);
    expect(
      rowBlocked({ key: "m", name: "x", category: "other", module, origin: away }, SELF, null),
    ).toBe(false);
    expect(rowBlocked({ key: "m", name: "x", category: "other", module }, SELF, "@acme/y")).toBe(
      true,
    );
    expect(rowBlocked({ key: "m", name: "x", category: "other", module }, undefined, null)).toBe(
      true,
    );
  });
});
