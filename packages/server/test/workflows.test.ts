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
import { ScriptContractError, evaluateWorkflow } from "../src/workflows/evaluate.js";
import { WorkflowRegistry } from "../src/workflows/registry.js";
import { WorkflowLifecycle } from "../src/workflows/service.js";
import { Hono } from "hono";
import { handleError } from "../src/http/errors.js";
import { workflowRoutes } from "../src/workflows/routes.js";
import { WorkflowIdError, WorkflowStore } from "../src/workflows/store.js";
import type { StoredWorkflow } from "../src/workflows/store.js";

const SCRIPT = `return { name: "counter", version: 1, run: (input) => ({ echoed: input }) };`;
const RUN_CTX = { runAgent: async () => "" };

describe("workflow scripts", () => {
  it("resumes from the state the previous instance parked", () => {
    const script = `const n = context.state?.n ?? 0;
       return { name: "counterish", version: 1, run: () => n, park: () => ({ n: n + 1 }) };`;
    const first = evaluateWorkflow(script);
    expect(first.run(null, RUN_CTX)).toBe(0);
    expect(first.park?.()).toEqual({ n: 1 });
    // A rebuild - what a swap does - picks up where the park left off.
    expect(evaluateWorkflow(script, { n: 1 }).run(null, RUN_CTX)).toBe(1);
  });

  it("refuses a script that does not parse, throw-free, into the contract", () => {
    expect(() => evaluateWorkflow("this is not javascript {{")).toThrow(ScriptContractError);
    expect(() => evaluateWorkflow("throw new Error('boom');")).toThrow(/threw while evaluating/);
    expect(() => evaluateWorkflow("return { name: 'x' };")).toThrow(/contract violation/);
    expect(() => evaluateWorkflow("return { name: '', version: 1, run: () => 1 };")).toThrow(
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
    const index = Buffer.from("<b>hi</b>").toString("base64");
    await expect(
      store.install(ref, SCRIPT, {
        "index.html": index,
        "../../pwned.txt": Buffer.from("x").toString("base64"),
      }),
    ).rejects.toThrow(/escapes the workflow directory/);
    // A UI is served as a page, so an entry is required before anything is written.
    await expect(store.install(ref, SCRIPT, { "a.js": index })).rejects.toThrow(/no index\.html/);
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
    const registry = new WorkflowRegistry(factories, () => RUN_CTX);
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

  it("unregisters an installation, handing back what it parked", async () => {
    const registry = new WorkflowRegistry(factories, () => RUN_CTX);
    await store.install(ref, SCRIPT);
    registry.register((await store.read(ref))!);
    expect(registry.unregister(ref)).toEqual({ parked: null });
    expect(registry.unregister(ref)).toBeNull();
    expect(factories.has("counter")).toBe(false);
    expect(registry.instanceView().names()).toEqual([]);
  });

  it("binds the tools a workflow registers, and drops them with it", async () => {
    const script = `return {
      name: "toolful", version: 1,
      run: () => null,
      setup: (ctx) => ctx.registerTool({ name: "greet", description: "says hi", run: () => "hi" }),
    };`;
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    await store.install(ref, script);
    const summary = registry.register(stored(ref, script));
    expect(summary.tools).toEqual([
      { workflowId: "agent/counter", name: "greet", description: "says hi" },
    ]);
    expect(registry.tools.get("greet")?.run(null)).toBe("hi");
    registry.unregister(ref);
    expect(registry.tools.list()).toEqual([]);
  });

  it("refuses a tool name another workflow owns, leaving nothing half-registered", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const tool = (name: string) =>
      `return { name: "${name}", version: 1, run: () => null,
        setup: (ctx) => ctx.registerTool({ name: "greet", description: "d", run: () => 1 }) };`;
    registry.register(stored(ref, tool("first")));
    expect(() =>
      registry.register(stored({ ...ref, workflowId: "other" }, tool("second"))),
    ).toThrow(/already registered by workflow/);
    expect(registry.tools.list()).toHaveLength(1);
    expect(registry.list()).toHaveLength(1);
  });

  it("tells a workflow plainly when no agent is configured to run", async () => {
    const registry = new WorkflowRegistry(new Map());
    const script = `return { name: "caller", version: 1, run: (i, ctx) => ctx.runAgent("hi") };`;
    registry.register(stored(ref, script));
    expect(() => registry.instanceView().run("caller", null)).toThrow(/no agent to run/);
  });
});

/** The shape `store.read` returns, for cases that vary the script without a disk round-trip. */
function stored(
  ref: { projectId: string; agentId: string; workflowId: string },
  script: string,
): StoredWorkflow {
  return { ...ref, id: `${ref.agentId}/${ref.workflowId}`, script, uiRev: null };
}

describe("WorkflowLifecycle", () => {
  let root: string;
  let store: WorkflowStore;
  const ref = { projectId: "proj", agentId: "agent", workflowId: "counter" };
  const STATEFUL = `const n = context.state?.n ?? 0;
    return { name: "counter", version: 1, run: () => n, park: () => ({ n: n + 1 }) };`;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-workflows-"));
    store = new WorkflowStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const lifecycleOver = (registry: WorkflowRegistry): WorkflowLifecycle =>
    new WorkflowLifecycle(store, registry, () => {});

  it("registers an agent's workflows while it is active, and parks them when it is not", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);

    await lifecycle.activate("proj", "agent");
    expect(lifecycle.isActive("proj", "agent")).toBe(true);
    expect(registry.instanceView().run("counter", null)).toBe(0);

    await lifecycle.deactivate("proj", "agent");
    expect(lifecycle.isActive("proj", "agent")).toBe(false);
    expect(registry.instanceView().names()).toEqual([]);
    // What park() returned is on disk, so the next activation resumes from it.
    expect(await store.readState(ref)).toEqual({ n: 1 });
    await lifecycle.activate("proj", "agent");
    expect(registry.instanceView().run("counter", null)).toBe(1);
  });

  it("counts holds: a second session does not re-register, and the first release does not park", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);
    await lifecycle.activate("proj", "agent");
    await lifecycle.activate("proj", "agent");
    await lifecycle.deactivate("proj", "agent");
    expect(registry.instanceView().names()).toEqual(["counter"]);
    await lifecycle.deactivate("proj", "agent");
    expect(registry.instanceView().names()).toEqual([]);
  });

  it("reseeds into a fresh App, so a push is invisible to a live workflow", async () => {
    const first = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const before = lifecycleOver(first);
    await store.install(ref, STATEFUL);
    await store.install({ ...ref, workflowId: "idle" }, STATEFUL.replace("counter", "idle"));
    await before.activate("proj", "agent");
    const parked = before.refs();
    expect(parked.map((r) => r.workflowId).sort()).toEqual(["counter", "idle"]);

    const next = new WorkflowRegistry(new Map(), () => RUN_CTX);
    await lifecycleOver(next).reseed(parked);
    expect(next.instanceView().names().sort()).toEqual(["counter", "idle"]);
  });

  it("installs live for an active agent and stores for an idle one", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);
    expect(await lifecycle.installed(ref)).toBeNull();
    expect(registry.instanceView().names()).toEqual([]);

    await lifecycle.activate("proj", "agent");
    await store.install({ ...ref, workflowId: "later" }, STATEFUL.replace("counter", "later"));
    const summary = await lifecycle.installed({ ...ref, workflowId: "later" });
    expect(summary?.name).toBe("later");
    expect(registry.instanceView().names().sort()).toEqual(["counter", "later"]);
  });

  it("drops a removed workflow without parking it", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);
    await lifecycle.activate("proj", "agent");
    await lifecycle.removed(ref);
    expect(registry.instanceView().names()).toEqual([]);
    expect(lifecycle.refs()).toEqual([]);
  });

  it("keeps an agent's other workflows when one no longer loads", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);
    await store.install({ ...ref, workflowId: "broken" }, "throw new Error('boom');");
    await lifecycle.activate("proj", "agent");
    expect(registry.instanceView().names()).toEqual(["counter"]);
  });

  it("parks every activation on shutdown", async () => {
    const registry = new WorkflowRegistry(new Map(), () => RUN_CTX);
    const lifecycle = lifecycleOver(registry);
    await store.install(ref, STATEFUL);
    await lifecycle.activate("proj", "agent");
    await lifecycle.activate("proj", "agent");
    await lifecycle.shutdown();
    expect(lifecycle.isActive("proj", "agent")).toBe(false);
    expect(await store.readState(ref)).toEqual({ n: 1 });
  });
});

describe("workflow routes: who may integrate", () => {
  // The group is mounted into an app that shapes HttpError (app.ts's createApp); standing
  // one up here is what makes the status the route throws the status a caller sees.
  const get = (user: { userId: string; isAdmin: boolean } | null) => {
    const app = new Hono();
    app.onError((err, c) => handleError(err, c));
    app.route(
      "/",
      workflowRoutes({
        store: new WorkflowStore("/nowhere"),
        registry: new WorkflowRegistry(new Map()),
        lifecycle: {} as never,
        identity: async () => user,
      }),
    );
    return app.fetch(new Request("http://localhost/api/workflows"));
  };

  it("refuses an unauthenticated caller", async () => {
    expect((await get(null)).status).toBe(401);
  });

  it("refuses a signed-in non-admin: installing runs code as the server", async () => {
    expect((await get({ userId: "someone", isAdmin: false })).status).toBe(403);
  });

  it("admits an operator", async () => {
    expect((await get({ userId: "admin", isAdmin: true })).status).toBe(200);
  });
});
