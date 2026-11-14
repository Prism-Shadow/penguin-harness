/**
 * The compile pipeline over hand-written trees: ordering by declared `after` (cycles
 * loud, unregistered ids vacuous), the registry read off the tree's own manifests,
 * requires checked against the CURRENT tree, per-pass failure isolation, and the final
 * verify — the kernel's own checkTree, first problem first. The table is the real
 * generated one, so a requires check answers as it will at boot.
 */
import { describe, expect, it, vi } from "vitest";
import { defineModule, parseManifest } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable, Manifest, ModuleDef } from "@prismshadow/penguin-core/kernel";
import { Log } from "../src/hmr/capabilities.js";
import { compileModuleDef, PASSES_SLOT } from "../src/compile/module.js";
import { compileModuleTree, describeCompile, type ModulePass } from "../src/compile/pipeline.js";
import type { PassDecl } from "../src/compile/module.js";
import table from "../src/ifaces.json" with { type: "json" };

const ifaces = table as unknown as IfaceTable;
const LOG = "@prismshadow/penguin-server#Log";

const manifest = (m: Partial<Manifest> & { name: string }): Manifest =>
  parseManifest({ requires: {}, provides: {}, contributes: {}, children: [], ...m });

/** A module whose create hands back nothing: the compile reads manifests, not code. */
const leaf = (m: Manifest): ModuleDef => defineModule(m, { create: () => ({ api: {} }) });

/** A pass registration, as a contributing module's manifest carries it. */
const registering = (...passes: PassDecl[]): ModuleDef =>
  leaf(
    manifest({
      name: "passModules",
      contributes: {
        [PASSES_SLOT]: passes.map((p) => ({
          id: p.id,
          ...(p.after === undefined ? {} : { after: [...p.after] }),
        })),
      },
    }),
  );

/** The tree every test below compiles: the platform root, CompileModule, and the registrations. */
const tree = (...children: ModuleDef[]): ModuleDef =>
  defineModule(manifest({ name: "platform", children: ["*"] }), {
    create: () => ({ api: {} }),
    children: [compileModuleDef(), ...children],
  });

/** A pass that appends one child module — the rewrite a real instrument takes. */
const appending = (
  id: string,
  child: Manifest,
  requires: ModulePass["requires"] = [],
): ModulePass => ({
  id,
  requires,
  rewrite: (t) => ({ ...t, children: [...(t.children ?? []), leaf(child)] }),
});

describe("the module-tree compile", () => {
  it("rejects malformed scheduling data before a pass factory can run", async () => {
    const resolve = vi.fn();
    const input = tree(registering({ id: "bad", after: [null] as unknown as string[] }));
    await expect(compileModuleTree(input, { ifaces, resolve })).rejects.toThrow(
      "optional array of after ids",
    );
    expect(resolve).not.toHaveBeenCalled();
  });
  it("runs passes in `after` order, whatever the registration order was", async () => {
    const compiled = await compileModuleTree(
      tree(registering({ id: "late", after: ["early"] }, { id: "early" })),
      { ifaces, resolve: (id) => appending(id, manifest({ name: `grew-${id}` })), debug: true },
    );
    expect(compiled.tree.children?.map((c) => c.manifest.name)).toEqual([
      "CompileModule",
      "passModules",
      "grew-early",
      "grew-late",
    ]);
    expect(compiled.trace.map((t) => `${t.id}:${t.state}`)).toEqual([
      "early:applied",
      "late:applied",
    ]);
  });

  it("a cycle in `after` is a loud error naming the path", async () => {
    await expect(
      compileModuleTree(tree(registering({ id: "a", after: ["b"] }, { id: "b", after: ["a"] })), {
        ifaces,
        resolve: (id) => appending(id, manifest({ name: `grew-${id}` })),
      }),
    ).rejects.toThrowError("pass dependencies form a cycle: a -> b -> a");
  });

  it("an `after` naming an id nobody registered is vacuous, not an error", async () => {
    const compiled = await compileModuleTree(tree(registering({ id: "lone", after: ["ghost"] })), {
      ifaces,
      resolve: (id) => appending(id, manifest({ name: `grew-${id}` })),
      debug: true,
    });
    expect(compiled.trace.map((t) => `${t.id}:${t.state}`)).toEqual(["lone:applied"]);
  });

  it("requires are checked against the CURRENT tree, and re-checked after a rewrite", async () => {
    const pass = (id: string, requires: ModulePass["requires"]): ModulePass => ({
      id,
      requires,
      rewrite: (t) => ({
        ...t,
        children: [...(t.children ?? []), leaf(manifest({ name: `grew-${id}` }))],
      }),
    });
    // The tree provides no Log, so a pass that needs it is skipped with the reason kept.
    const bare = await compileModuleTree(tree(registering({ id: "needsLog" })), {
      ifaces,
      resolve: () => pass("needsLog", [Log]),
      debug: true,
    });
    expect(bare.trace).toEqual([
      { id: "needsLog", state: "skipped", ms: 0, why: "requires [Log], not provided by this tree" },
    ]);
    // A pass that grows the provision makes the same requirement true for the next pass.
    const grown = await compileModuleTree(
      tree(registering({ id: "grow" }, { id: "needsLog", after: ["grow"] })),
      {
        ifaces,
        resolve: (id) =>
          id === "grow"
            ? appending("grow", manifest({ name: "logGrew", provides: { log: LOG } }))
            : pass("needsLog", [Log]),
        debug: true,
      },
    );
    expect(grown.trace.map((t) => `${t.id}:${t.state}`)).toEqual([
      "grow:applied",
      "needsLog:applied",
    ]);
  });

  it("a failed pass falls back to the previous tree and the next pass still runs", async () => {
    const boom = vi.fn(() => {
      throw new Error("the pass broke");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compiled = await compileModuleTree(
      tree(registering({ id: "boom" }, { id: "ok", after: ["boom"] })),
      {
        ifaces,
        resolve: (id) =>
          id === "boom" ? { id, rewrite: boom } : appending("ok", manifest({ name: "grew-ok" })),
        debug: true,
      },
    );
    // The failed pass's rewrite ran once and was set aside; the tree it was handed is the
    // tree the boot gets, and the pass after it applied to that tree.
    expect(boom).toHaveBeenCalledTimes(1);
    expect(compiled.tree.children?.map((c) => c.manifest.name)).toEqual([
      "CompileModule",
      "passModules",
      "grew-ok",
    ]);
    expect(compiled.trace.map((t) => `${t.id}:${t.state}`)).toEqual(["boom:failed", "ok:applied"]);
    expect(warn).toHaveBeenCalledWith(
      "[compile] pass 'boom' failed and was set aside: the pass broke",
    );
    warn.mockRestore();
  });

  it("a pass that returns no tree is set aside like a throwing one", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compiled = await compileModuleTree(tree(registering({ id: "gone" })), {
      ifaces,
      // A rewrite that answers nothing is a bug in a pass, not a boot to take down.
      resolve: () => ({ id: "gone", rewrite: () => undefined as unknown as ModuleDef }),
      debug: true,
    });
    expect(compiled.trace.map((t) => `${t.id}:${t.state}:${t.why}`)).toEqual([
      "gone:failed:pass 'gone' returned no tree",
    ]);
    expect(compiled.tree.children?.map((c) => c.manifest.name)).toEqual([
      "CompileModule",
      "passModules",
    ]);
    warn.mockRestore();
  });

  it("a registered id nothing resolves is warned and skipped, the registration intact", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const compiled = await compileModuleTree(tree(registering({ id: "wired" })), {
      ifaces,
      resolve: () => undefined,
      debug: true,
    });
    expect(compiled.trace).toEqual([
      { id: "wired", state: "skipped", ms: 0, why: "registered, no resolver for this id" },
    ]);
    expect(warn).toHaveBeenCalledWith(
      "[compile] pass 'wired' is registered but nothing resolves it",
    );
    warn.mockRestore();
  });

  it("rejects duplicate pass registrations before running either factory", async () => {
    const rewrite = vi.fn(appending("dup", manifest({ name: "grew-dup" })).rewrite);
    // Registration identity is a representation invariant, not an intermediate type mismatch.
    await expect(
      compileModuleTree(tree(registering({ id: "dup" }, { id: "dup", after: [] })), {
        ifaces,
        resolve: () => ({ id: "dup", rewrite }),
      }),
    ).rejects.toThrowError("contribution id 'dup' is already used by");
    expect(rewrite).not.toHaveBeenCalled();
  });

  it("a pass that breaks the tree fails the compile at the verify, first problem first", async () => {
    await expect(
      compileModuleTree(tree(registering({ id: "breaks" })), {
        ifaces,
        resolve: () =>
          appending("breaks", manifest({ name: "bogus", provides: { x: "Bogus#Nope" } })),
      }),
    ).rejects.toThrowError(
      "module tree rejected at compile:\n  - /platform/bogus: 'x' names interface 'Bogus#Nope', which the table does not carry",
    );
  });

  it("a tree that registers nothing compiles to itself, silently and untimed", async () => {
    const compiled = await compileModuleTree(tree(), { ifaces });
    expect(compiled.trace).toEqual([]);
    expect(describeCompile(compiled.trace)).toBe("no passes");
    // No pass, no rewrite: the boot gets the tree exactly as it was assembled.
    expect(compiled.tree.children?.map((c) => c.manifest.name)).toEqual(["CompileModule"]);
  });

  it("the trace exists only in a debug compile", async () => {
    const quiet = await compileModuleTree(tree(registering({ id: "quietly" })), {
      ifaces,
      resolve: (id) => appending(id, manifest({ name: `grew-${id}` })),
    });
    expect(quiet.trace).toEqual([]);
    const debug = await compileModuleTree(tree(registering({ id: "loudly" })), {
      ifaces,
      resolve: (id) => appending(id, manifest({ name: `grew-${id}` })),
      debug: true,
    });
    expect(debug.trace).toHaveLength(1);
    expect(debug.trace[0]).toMatchObject({ id: "loudly", state: "applied" });
    expect(typeof debug.trace[0]?.ms).toBe("number");
  });
});

it("the boot's own boot accepts what the compile accepted", async () => {
  // The compile's verify is the kernel's own checkTree, so a compiled tree boots: this
  // is the same pair createInner runs (compile, then bootModules over the compiled tree).
  const { bootModules } = await import("@prismshadow/penguin-core/kernel");
  const logNode = defineModule(manifest({ name: "logNode", provides: { log: LOG } }), {
    create: () => ({ api: { log: { line: () => {} } } }),
  });
  const compiled = await compileModuleTree(tree(registering({ id: "grows" }), logNode), {
    ifaces,
    resolve: (id) => appending(id, manifest({ name: `grew-${id}` })),
  });
  const booted = await bootModules(compiled.tree, {
    ifaces,
    compare: compiled.compare,
    resources: { register: () => () => {}, claim: () => undefined },
  });
  expect(booted.has("grew-grows")).toBe(true);
  expect(typeof booted.api<{ line(): void }>("logNode", "log").line).toBe("function");
});
