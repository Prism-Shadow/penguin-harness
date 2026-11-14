/**
 * - Given a provider added after telemetry, boot instruments its calls once through exports and aliases.
 * - Given the telemetry plugin on the real App, session and trace calls produce samples.
 * - Given an application rejection or observer failure, telemetry preserves the application's result.
 * - Given a mock and cross-owner slot filtering, boot uses the mock and keeps unrelated contributions/components.
 * - Given a temporarily missing provider, a later operator can repair it before final verification.
 * - Given an unrepaired removal or type mismatch, final diagnostics name the editing operator.
 * - Given a failing pass, neither nested manifest edits nor deferred rules leak into the next pass or generation.
 * - Given install, recompile and uninstall, wrappers never stack and removed contributions return.
 * - Given a pass that breaks another plugin, best-effort excludes its author and rebuilds the victim.
 * - Given a deferred callback failure, the error names its operator and retries restore the source tree.
 * - Given a slot edit reordering owners, the edit fails instead of silently changing its result.
 * - Given registration permutations, independent passes keep the same order.
 * - Given malformed operations or cyclic input, compilation reports failure without running factories.
 */
import { describe, expect, it, vi } from "vitest";
import {
  add,
  and,
  at,
  bootModules,
  byId,
  byName,
  decorate,
  defineModule,
  filter,
  has,
  interfaceRef,
  moduleDefOf,
  not,
  or,
  parseManifest,
  pipe,
  provides,
  remove,
  replace,
  when,
  wrapMethods,
} from "@prismshadow/penguin-core/kernel";
import type {
  IfaceTable,
  Manifest,
  ModuleDef,
  ModulePass,
  ModuleTree,
  SlotEntry,
} from "@prismshadow/penguin-core/kernel";
import table from "../src/ifaces.json" with { type: "json" };
import { compileModuleDef, PASSES_SLOT } from "../src/compile/module.js";
import { compileModuleTree } from "../src/compile/pipeline.js";
import { telemetryPlugin, type TelemetrySample } from "../src/compile/demo/telemetry.js";
import { passResolver, PluginHost, type LoadedPlugin } from "../src/plugin/host.js";
import {
  bootWithoutUnsatisfied,
  UnsatisfiedPluginsError,
  type PluginSelection,
} from "../src/plugin/unsatisfied.js";
import { createTestApp } from "./helpers.js";

const TRACE = "@prismshadow/penguin-server#TraceIndex";
const READ = "test#Read",
  NUMBER = "test#NumberRead",
  TABS = "test#Tabs";
const ifaces: IfaceTable = {
  ifaces: {
    ...(table as unknown as IfaceTable).ifaces,
    [READ]: {
      name: "Read",
      methods: { read: { params: [], returns: { promise: { data: "string" } } } },
      slots: {},
    },
    [NUMBER]: {
      name: "NumberRead",
      methods: { read: { params: [], returns: { promise: { data: "number" } } } },
      slots: {},
    },
    [TABS]: { name: "Tabs", methods: {}, slots: { sessionTabs: { data: { label: "string" } } } },
  },
  types: (table as unknown as IfaceTable).types,
};
const resources = { register: () => () => {}, claim: () => undefined };
const manifest = (partial: Partial<Manifest> & { name: string }): Manifest =>
  parseManifest({ requires: {}, provides: {}, contributes: {}, children: [], ...partial });
const leaf = (
  partial: Partial<Manifest> & { name: string },
  api: Record<string, unknown> = {},
): ModuleDef => defineModule(manifest(partial), { create: () => ({ api }) });
const root = (...children: ModuleDef[]): ModuleDef =>
  defineModule(manifest({ name: "Root", children: ["*"] }), {
    create: () => ({ api: {} }),
    children: [compileModuleDef(), ...children],
  });
const registration = (id: string, after: string[] = []): ModuleDef =>
  leaf({ name: `Pass_${id}`, contributes: { [PASSES_SLOT]: [{ id, after }] } });
const installed = (id: string, rewrite: ModulePass["rewrite"]): LoadedPlugin => ({
  specifier: `@test/${id}`,
  modules: [registration(id)],
  replaces: [],
  passes: { [id]: () => ({ id, rewrite }) },
});
const compile = (input: ModuleDef, ...passes: ModulePass[]) =>
  compileModuleTree(input, {
    ifaces,
    resolve: (id) => passes.find((pass) => pass.id === id),
    debug: true,
  });
const start = async (input: ModuleDef, ...passes: ModulePass[]): Promise<ModuleTree> => {
  const result = await compile(input, ...passes);
  return bootModules(result.tree, { ifaces, resources, compare: result.compare });
};

class Index {
  #calls = 0;
  get counters() {
    return { gateStats: this.#calls, dirScans: 0, headReads: 0 };
  }
  async reconcileAgent(_project: string, _agent: string): Promise<void> {
    this.#calls++;
  }
  async reconcileProject(): Promise<void> {}
  registerImportedFile(): void {}
  removeSession(): void {}
  removeAgent(): void {}
  removeProject(): void {}
}
const indexDef = (): ModuleDef =>
  defineModule(manifest({ name: "Index", provides: { index: TRACE, same: TRACE } }), {
    create: () => {
      const index = new Index();
      return { api: { index, same: index } };
    },
  });
const reader = (ref = READ, value: unknown = { read: async () => "real" }): ModuleDef =>
  leaf({ name: "Reader", provides: { read: ref } }, { read: value });
const consumer = (): ModuleDef =>
  defineModule(
    manifest({ name: "Consumer", requires: { read: { iface: READ, from: "Reader" } } }),
    {
      create: () => ({ api: {}, bind: {}, park: () => null }),
    },
  );
const tabs = (): ModuleDef[] => [
  defineModule(manifest({ name: "Chat", provides: { tabs: TABS } }), {
    create: (ctx) => ({
      api: { tabs: { entries: ctx.contributions.sessionTabs!.map((entry) => entry.id) } },
    }),
  }),
  leaf({ name: "OldTab", contributes: { "Chat.sessionTabs": [{ id: "legacy", label: "Old" }] } }),
  leaf({
    name: "NewTab",
    contributes: {
      "Chat.sessionTabs": [
        { id: "replacement", label: "New" },
        { id: "kept", label: "Kept" },
      ],
    },
  }),
];

describe("pipeable module passes", () => {
  it("records real App service calls through the plugin factory", async () => {
    const samples: TelemetrySample[] = [];
    const plugin = telemetryPlugin((sample) => samples.push(sample));
    const plugins = new PluginHost();
    plugins.use({
      specifier: "@test/telemetry",
      replaces: [],
      passes: plugin.passes,
      modules: plugin.modules!.map((module) =>
        moduleDefOf(module, {
          manifests: table.modules as unknown as Record<string, Manifest>,
        }),
      ),
    });
    const app = await createTestApp({ plugins });
    try {
      samples.length = 0;
      await app.deps.sessionService.listSessions("default_project", "default_agent");
      await app.deps.traceIndex.reconcileAgent("default_project", "default_agent");
      expect(samples.filter((sample) => sample.probe === "sessions.list")).toEqual([
        { probe: "sessions.list", status: "ok", durationMs: expect.any(Number) },
      ]);
      expect(samples).toContainEqual({
        probe: "trace.reconcile",
        status: "ok",
        durationMs: expect.any(Number),
      });
    } finally {
      await app.cleanup();
    }
  });

  it("instruments a later provider once through exported and shared aliases", async () => {
    const samples: TelemetrySample[] = [];
    const plugin = telemetryPlugin((sample) => samples.push(sample));
    const telemetry = plugin.passes!.telemetry!();
    const group = defineModule(
      manifest({
        name: "IndexGroup",
        provides: { index: TRACE },
        exports: ["index"],
        children: ["Index"],
      }),
      {
        create: () => ({ api: {} }),
        children: [indexDef()],
      },
    );
    const input = root(
      moduleDefOf(plugin.modules![0]!, {
        manifests: table.modules as unknown as Record<string, Manifest>,
      }),
      registration("grow", ["telemetry"]),
    );
    const booted = await start(input, telemetry, {
      id: "grow",
      rewrite: add(byName("Root"), group),
    });
    const api = booted.api<Index>("IndexGroup", "index");
    await api.reconcileAgent("project", "agent");
    expect(api.counters.gateStats).toBe(1);
    expect(api.toString()).toBe("[object Object]");
    expect(api).toBe(booted.api("Index", "same"));
    expect(samples).toEqual([
      { probe: "trace.reconcile", status: "ok", durationMs: expect.any(Number) },
    ]);
    expect(input.children?.some((node) => node.manifest.name === "IndexGroup")).toBe(false);
    booted.dispose();
  });

  it("preserves rejections and successful values when a sample observer throws", async () => {
    const failure = new Error("application failure");
    const statuses: string[] = [];
    const plugin = telemetryPlugin((sample) => {
      statuses.push(sample.status);
      throw new Error("observer failure");
    });
    const broken = new Index();
    broken.reconcileAgent = async () => {
      throw failure;
    };
    const booted = await start(
      root(
        registration("telemetry"),
        leaf({ name: "Index", provides: { index: TRACE } }, { index: broken }),
      ),
      plugin.passes!.telemetry!(),
    );
    const api = booted.api<Index>("Index", "index");
    await expect(api.reconcileAgent("p", "a")).rejects.toBe(failure);
    broken.reconcileAgent = async () => {};
    await expect(api.reconcileAgent("p", "a")).resolves.toBeUndefined();
    expect(statuses).toEqual(["error", "ok"]);
    booted.dispose();
  });

  it("composes mock replacement with conditional filtering across contribution owners", async () => {
    const source = root(registration("test"), reader(), ...tabs());
    const booted = await start(source, {
      id: "test",
      rewrite: pipe(
        replace(byName("Reader"), reader(READ, { read: async () => "mock" })),
        at(
          "Chat.sessionTabs",
          when(has<SlotEntry>(byId("replacement")), filter(not(byId("legacy")))),
        ),
      ),
    });
    await expect(booted.api<{ read(): Promise<string> }>("Reader", "read").read()).resolves.toBe(
      "mock",
    );
    expect(booted.api<{ entries: string[] }>("Chat", "tabs").entries).toEqual([
      "replacement",
      "kept",
    ]);
    expect(booted.has("OldTab")).toBe(true);
    expect(
      source.children?.find((node) => node.manifest.name === "OldTab")?.manifest.contributes[
        "Chat.sessionTabs"
      ],
    ).toHaveLength(1);
    booted.dispose();
  });

  it("allows a missing provider between remove and add", async () => {
    const booted = await start(root(registration("repair"), reader(), consumer()), {
      id: "repair",
      rewrite: pipe(remove(byName("Reader")), add(byName("Root"), reader())),
    });
    expect(booted.has("Consumer")).toBe(true);
    booted.dispose();
  });

  it("reports the deleting operator when a final dependency is missing", async () => {
    const result = compile(root(registration("remove"), reader(), consumer()), {
      id: "remove",
      rewrite: remove(byName("Reader")),
    });
    await expect(result).rejects.toThrow(/Consumer.*requires.read[\s\S]*remove\/remove#1/);
  });

  it("maps a final tsc mismatch to the replacement and accepts a later repair", async () => {
    const broken = reader(NUMBER, { read: async () => 7 });
    const input = root(registration("mock"), reader(), consumer());
    const result = compile(input, { id: "mock", rewrite: replace(byName("Reader"), broken) });
    await expect(result).rejects.toThrow(/TS2322[\s\S]*mock\/replace#1/);
    const repaired = await start(input, {
      id: "mock",
      rewrite: pipe(replace(byName("Reader"), broken), replace(byName("Reader"), reader())),
    });
    expect(repaired.has("Consumer")).toBe(true);
    repaired.dispose();
  });

  it("discards a failed pass's deferred rule and prevents nested source mutations", async () => {
    const observed: string[] = [];
    const source = root(registration("broken"), reader());
    const rule = decorate(provides(interfaceRef<{ read(): Promise<string> }>(READ)), (api) =>
      wrapMethods(api, {
        read: (next) => async () => {
          observed.push("wrapped");
          return next();
        },
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await compile(source, {
      id: "broken",
      rewrite: (tree, ctx) => {
        rule(tree, ctx);
        const provisions = tree.children!.find((node) => node.manifest.name === "Reader")!.manifest
          .provides as Record<string, string>;
        provisions.read = "invalid#Type";
        return tree;
      },
    });
    expect(result.trace[0]?.state).toBe("failed");
    const booted = await bootModules(result.tree, { ifaces, resources, compare: result.compare });
    await expect(booted.api<{ read(): Promise<string> }>("Reader", "read").read()).resolves.toBe(
      "real",
    );
    expect(observed).toEqual([]);
    expect(
      source.children!.find((node) => node.manifest.name === "Reader")!.manifest.provides.read,
    ).toBe(READ);
    booted.dispose();
  });

  it("recompiles installation without stacking wrappers and restores edits on uninstall", async () => {
    const seen: string[] = [];
    const plugin = installed(
      "instrument",
      pipe(
        at("Chat.sessionTabs", filter(not(byId("legacy")))),
        decorate(provides(interfaceRef<{ read(): Promise<string> }>(READ)), (api) =>
          wrapMethods(api, {
            read: (next) => async () => {
              seen.push("call");
              return next();
            },
          }),
        ),
      ),
    );
    const original = [reader(), ...tabs()];
    for (const selection of [[plugin], [plugin], []]) {
      const host = new PluginHost();
      for (const entry of selection) host.use(entry);
      const compiled = await compileModuleTree(root(...original, ...host.modules()), {
        ifaces,
        resolve: passResolver(selection),
      });
      const booted = await bootModules(compiled.tree, {
        ifaces,
        resources,
        compare: compiled.compare,
      });
      await booted.api<{ read(): Promise<string> }>("Reader", "read").read();
      expect(booted.api<{ entries: string[] }>("Chat", "tabs").entries).toEqual(
        selection.length ? ["replacement", "kept"] : ["legacy", "replacement", "kept"],
      );
      booted.dispose();
    }
    expect(seen).toEqual(["call", "call"]);
  });

  it("excludes a pass's plugin rather than the module it broke", async () => {
    const plugin = installed("breaks-core", remove(byName("Reader")));
    const { tree, unsatisfied } = await bootWithoutUnsatisfied([plugin], async (kept) => {
      const compiled = await compileModuleTree(root(reader(), consumer(), ...kept.modules), {
        ifaces,
        resolve: kept.resolvePass,
      });
      return bootModules(compiled.tree, { ifaces, resources, compare: compiled.compare });
    });
    expect(tree.has("Reader")).toBe(true);
    expect(unsatisfied).toMatchObject([{ specifier: "@test/breaks-core", disabled: true }]);
    tree.dispose();
  });

  it("uses deterministic order regardless of registration order", async () => {
    const passes = ["a", "b"].map((id): ModulePass => ({
      id,
      rewrite: add(byName("Root"), leaf({ name: `Made_${id}` })),
    }));
    const a = await compile(root(registration("b"), registration("a")), ...passes);
    const b = await compile(root(registration("a"), registration("b")), ...passes);
    expect(a.trace.map((entry) => entry.id)).toEqual(b.trace.map((entry) => entry.id));
    expect(a.trace.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it.each(["selection", "wrapping"] as const)(
    "attributes a deferred %s failure and rebuilds without its plugin",
    async (phase) => {
      const plugin = installed(
        "broken-decoration",
        pipe(
          at("Chat.sessionTabs", filter(not(byId("legacy")))),
          decorate<{ read(): Promise<string> }>(
            (target) => {
              if (phase === "selection") throw new Error("broken predicate");
              return target.iface === READ;
            },
            () => {
              throw new Error("broken wrapper");
            },
          ),
        ),
      );
      const boot = async (kept: PluginSelection) => {
        const compiled = await compileModuleTree(root(reader(), ...tabs(), ...kept.modules), {
          ifaces,
          resolve: kept.resolvePass,
        });
        return bootModules(compiled.tree, { ifaces, resources, compare: compiled.compare });
      };
      await expect(bootWithoutUnsatisfied([plugin], boot, "refuse")).rejects.toBeInstanceOf(
        UnsatisfiedPluginsError,
      );
      const { tree, unsatisfied } = await bootWithoutUnsatisfied([plugin], boot);
      expect(tree.api<{ entries: string[] }>("Chat", "tabs").entries).toEqual([
        "legacy",
        "replacement",
        "kept",
      ]);
      expect(unsatisfied).toMatchObject([
        {
          specifier: plugin.specifier,
          reason: expect.stringMatching(/broken-decoration\/decorate#\d+: (selection|wrapping)/),
        },
      ]);
      tree.dispose();
    },
  );

  it("refuses owner reordering instead of silently discarding it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await compile(root(registration("reorder"), ...tabs()), {
      id: "reorder",
      rewrite: at("Chat.sessionTabs", (entries) => [...entries].reverse()),
    });
    expect(result.trace).toMatchObject([
      { state: "failed", why: expect.stringContaining("preserve contributor order") },
    ]);
    const tree = await bootModules(result.tree, { ifaces, resources, compare: result.compare });
    expect(tree.api<{ entries: string[] }>("Chat", "tabs").entries).toEqual([
      "legacy",
      "replacement",
      "kept",
    ]);
    tree.dispose();
  });

  it("skips false predicates and preserves unselected nodes", async () => {
    const booted = await start(root(registration("select"), reader()), {
      id: "select",
      rewrite: pipe(
        when(and(byName("Other"), not(byName("Root"))), remove(byName("Reader"))),
        remove(and(or(byName("Other"), byName("AlsoOther")), not(byName("Reader")))),
      ),
    });
    expect(booted.has("Reader")).toBe(true);
    booted.dispose();
  });

  it.each([
    ["root removal", remove(byName("Root"))],
    ["identity change", replace(byName("Reader"), leaf({ name: "Wrong" }))],
    [
      "unknown contributor",
      at("Chat.sessionTabs", () => [{ id: "new", from: "Absent", data: {} }]),
    ],
  ])("isolates %s without changing the source", async (_label, rewrite) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await compile(root(registration("bad"), reader()), { id: "bad", rewrite });
    expect(result.trace[0]?.state).toBe("failed");
    expect(result.tree.children?.some((node) => node.manifest.name === "Reader")).toBe(true);
  });

  it("rejects cyclic containment before any module factory runs", async () => {
    const node = root();
    node.children!.push(node);
    await expect(compile(node)).rejects.toThrow("module containment cycle");
  });
});
