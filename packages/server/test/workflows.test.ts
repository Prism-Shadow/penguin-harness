/**
 * Installed workflows: the store's path rules, the script contract, and the live
 * registry that makes an install callable without a push.
 *
 * The registry is the piece worth pinning: it holds the App's own `iface.workflow` map,
 * so a plugin's workflow and an installed one are the same thing downstream, and an
 * install that arrives after the App opened still lands in that one map.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentStateDir } from "@prismshadow/penguin-core";
import type { WorkflowFactory } from "../src/hmr/plugin.js";
import { ScriptContractError, workflowFactoryFrom } from "../src/workflows/evaluate.js";
import { WorkflowRegistry, restoreWorkflows } from "../src/workflows/registry.js";
import { WorkflowIdError, WorkflowStore } from "../src/workflows/store.js";
import type { StoredWorkflow } from "../src/workflows/store.js";

const SCRIPT = `return { name: "counter", version: 1, run: (input) => ({ echoed: input }) };`;

describe("workflow scripts", () => {
  it("evaluates to a factory that builds a fresh instance per call", () => {
    const { factory, name } = workflowFactoryFrom(
      `let calls = 0;
       return { name: "stateful", version: 1, run: () => ++calls };`,
    );
    expect(name).toBe("stateful");
    // A factory that keeps state gets a fresh instance per App creation, so a swap can
    // never carry a half-built one across.
    expect(factory().run(null)).toBe(1);
    expect(factory().run(null)).toBe(1);
  });

  it("refuses a script that does not parse, throw-free, into the contract", () => {
    expect(() => workflowFactoryFrom("this is not javascript {{")).toThrow(ScriptContractError);
    expect(() => workflowFactoryFrom("throw new Error('boom');")).toThrow(/threw while evaluating/);
    expect(() => workflowFactoryFrom("return { name: 'x' };")).toThrow(/contract violation/);
    expect(() => workflowFactoryFrom("return { name: '', version: 1, run: () => 1 };")).toThrow(
      ScriptContractError,
    );
  });
});

describe("WorkflowStore", () => {
  let root: string;
  let store: WorkflowStore;
  const ref = { projectId: "proj", agentId: "agent", workflowId: "counter" };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-workflows-"));
    store = new WorkflowStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("writes under the agent's own folder, so a push never touches it", async () => {
    await store.install(ref, SCRIPT);
    const onDisk = path.join(agentStateDir(root, "proj", "agent"), "workflows", "counter");
    expect(fs.existsSync(path.join(onDisk, "workflow.js"))).toBe(true);
    const stored = await store.read(ref);
    expect(stored?.id).toBe("agent/counter");
    expect(stored?.script).toBe(SCRIPT);
    expect(stored?.uiRev).toBeNull();
  });

  it("rejects an id that is not a single path segment", async () => {
    for (const workflowId of ["..", ".", "", "a/b", "../escape"]) {
      await expect(store.install({ ...ref, workflowId }, SCRIPT)).rejects.toThrow(WorkflowIdError);
    }
  });

  it("refuses a ui path that escapes the workflow directory", async () => {
    await expect(
      store.install(ref, SCRIPT, { "../../pwned.txt": Buffer.from("x").toString("base64") }),
    ).rejects.toThrow(/escapes the workflow directory/);
  });

  it("serves ui files and hashes the tree, and declines traversal on read", async () => {
    await store.install(ref, SCRIPT, {
      "index.html": Buffer.from("<b>hi</b>").toString("base64"),
    });
    expect((await store.uiFile(ref, "index.html"))?.toString()).toBe("<b>hi</b>");
    expect(await store.uiFile(ref, "../workflow.js")).toBeNull();
    const first = (await store.read(ref))?.uiRev;
    expect(first).toMatch(/^[0-9a-f]{16}$/);
    await store.install(ref, SCRIPT, { "index.html": Buffer.from("<b>ho</b>").toString("base64") });
    expect((await store.read(ref))?.uiRev).not.toBe(first);
  });

  it("lists an agent's installations, and reads a missing one as none", async () => {
    await store.install(ref, SCRIPT);
    await store.install({ ...ref, workflowId: "other" }, SCRIPT);
    expect((await store.list("proj", "agent")).map((w) => w.workflowId)).toEqual([
      "counter",
      "other",
    ]);
    expect(await store.list("proj", "nobody")).toEqual([]);
    expect(await store.remove(ref)).toBe(true);
    expect(await store.remove(ref)).toBe(false);
    expect(await store.read(ref)).toBeNull();
  });
});

describe("WorkflowRegistry", () => {
  let root: string;
  let store: WorkflowStore;
  let factories: Map<string, WorkflowFactory>;
  const ref = { projectId: "proj", agentId: "agent", workflowId: "counter" };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-workflows-"));
    store = new WorkflowStore(root);
    factories = new Map();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("instantiates what plugins registered before it existed", () => {
    factories.set("from-plugin", () => ({ run: () => "plugin" }));
    const registry = new WorkflowRegistry(factories);
    expect(registry.instanceView().names()).toEqual(["from-plugin"]);
    expect(registry.instanceView().run("from-plugin", null)).toBe("plugin");
    // Not an installation: nothing on disk stands behind it.
    expect(registry.list()).toEqual([]);
  });

  it("registers an install into the same map, callable at once", async () => {
    const registry = new WorkflowRegistry(factories);
    await store.install(ref, SCRIPT);
    const summary = registry.register((await store.read(ref))!);
    expect(summary.name).toBe("counter");
    expect(summary.id).toBe("agent/counter");
    expect(factories.has("counter")).toBe(true);
    expect(registry.instanceView().run("counter", 42)).toEqual({ echoed: 42 });
  });

  it("refuses a name another workflow already owns, and lets a reinstall rename", async () => {
    factories.set("counter", () => ({ run: () => "plugin" }));
    const registry = new WorkflowRegistry(factories);
    await store.install(ref, SCRIPT);
    expect(() => registry.register(stored(ref, SCRIPT))).toThrow(/already registered/);

    const other = new WorkflowRegistry(new Map());
    await store.install(ref, SCRIPT);
    other.register(stored(ref, SCRIPT));
    const renamed = `return { name: "renamed", version: 1, run: () => 1 };`;
    other.register(stored(ref, renamed));
    expect(other.instanceView().names()).toEqual(["renamed"]);
    expect(other.list()).toHaveLength(1);
  });

  it("unregisters an installation and forgets its name", async () => {
    const registry = new WorkflowRegistry(factories);
    await store.install(ref, SCRIPT);
    registry.register((await store.read(ref))!);
    expect(registry.unregister(ref)).toBe(true);
    expect(registry.unregister(ref)).toBe(false);
    expect(factories.has("counter")).toBe(false);
    expect(registry.instanceView().names()).toEqual([]);
  });

  it("parks only the refs, and restores exactly those", async () => {
    const first = new WorkflowRegistry(new Map());
    await store.install(ref, SCRIPT);
    await store.install({ ...ref, workflowId: "second" }, SCRIPT.replace("counter", "second"));
    first.register((await store.read(ref))!);
    first.register((await store.read({ ...ref, workflowId: "second" }))!);
    const parked = first.refs();
    expect(parked).toEqual([
      { projectId: "proj", agentId: "agent", workflowId: "counter" },
      { projectId: "proj", agentId: "agent", workflowId: "second" },
    ]);

    // The next App: only the parked refs are reloaded — nothing sweeps the disk.
    await store.install({ ...ref, workflowId: "never-parked" }, SCRIPT.replace("counter", "third"));
    const next = new WorkflowRegistry(new Map());
    await restoreWorkflows(store, next, parked, () => {});
    expect(next.instanceView().names()).toEqual(["counter", "second"]);
  });

  it("skips a parked ref whose script is gone or broken, keeping the rest", async () => {
    await store.install(ref, SCRIPT);
    await store.install({ ...ref, workflowId: "broken" }, "throw new Error('boom');");
    const registry = new WorkflowRegistry(new Map());
    const lines: string[] = [];
    await restoreWorkflows(
      store,
      registry,
      [ref, { ...ref, workflowId: "broken" }, { ...ref, workflowId: "vanished" }],
      (line) => lines.push(line),
    );
    expect(registry.instanceView().names()).toEqual(["counter"]);
    expect(lines.join("\n")).toMatch(/broken/);
    expect(lines.join("\n")).toMatch(/vanished/);
  });
});

/** The shape `store.read` returns, for cases that vary the script without a disk round-trip. */
function stored(
  ref: { projectId: string; agentId: string; workflowId: string },
  script: string,
): StoredWorkflow {
  return { ...ref, id: `${ref.agentId}/${ref.workflowId}`, script, uiRev: null };
}
