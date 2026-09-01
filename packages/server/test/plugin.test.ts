/**
 * Behavior tests for the plugin seam: activate-once and its sealed subscription window,
 * typed event delivery in activation order, the two views (definition iface / flattened
 * instance context), disposables, workflow registration and calling, and re-delivery on
 * the boot a hot swap performs.
 */
import { describe, expect, it, vi } from "vitest";
import { boot, initialDoc } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import { PENGUIN_FAMILY, RUNTIME_INTERFACES_RESOURCE_ID } from "../src/hmr/capabilities.js";
import { PLUGINS_RESOURCE_ID, PluginHost, pluginHostFrom } from "../src/plugin/host.js";
import type { PenguinContext, PenguinInterface } from "@prismshadow/penguin-core/plugin";
import type { HarnessContext } from "../src/plugin/index.js";
import { instantiateWorkflows, WorkflowFactories } from "../src/plugin/workflow.js";
import type { WorkflowFactory } from "@prismshadow/penguin-core/plugin";

function emptyIface(): PenguinInterface {
  // The registry, not a bare Map: that IS the surface a plugin gets (see platform.ts).
  return {
    workflow: new WorkflowFactories(),
    tool: new Map(),
    sandbox: { registerProvider: () => {} },
  };
}

/**
 * A registry whose host declares itself a bare kernel — right family, no capabilities
 * offered. That declaration is what makes a terminals-only boot legal (see
 * capabilities.ts's RuntimeClaim); plugin delivery is business-independent, so this is
 * all these tests need behind the platform.
 */
function bareKernel(): HotResources {
  const r = new HotResources();
  r.register(RUNTIME_INTERFACES_RESOURCE_ID, { family: PENGUIN_FAMILY });
  return r;
}

/** Boot over `r`, muting the terminals-only warning a bare kernel legitimately prints. */
async function quietBoot(r: HotResources) {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    return await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, packagedPlatform.context),
      r,
    );
  } finally {
    warn.mockRestore();
  }
}

describe("plugin host", () => {
  it("activate runs once; typed events deliver both views in activation order", async () => {
    const host = new PluginHost();
    const log: string[] = [];
    let activations = 0;
    let seenIface: PenguinInterface | null = null;
    let seenCtx: PenguinContext | null = null;
    await host.use({
      activate(extCtx) {
        activations++;
        extCtx.on("initialize", (iface) => {
          seenIface = iface;
          log.push("a:initialize");
        });
        extCtx.on("create", (ctx) => {
          seenCtx = ctx;
          log.push("a:create");
        });
      },
    });
    await host.use({ activate: (extCtx) => extCtx.on("create", () => log.push("b:create")) });

    const iface = emptyIface();
    host.emit("initialize", iface);
    const ctx = { workflows: instantiateWorkflows(iface.workflow) } as PenguinContext;
    host.emit("create", ctx);
    const iface2 = emptyIface();
    host.emit("initialize", iface2);

    // activate ran once per plugin, while every event delivery re-walked the handlers.
    expect(activations).toBe(1);
    expect(log).toEqual(["a:initialize", "a:create", "b:create", "a:initialize"]);
    expect(seenIface).toBe(iface2);
    expect(seenCtx).toBe(ctx);
  });

  it("a subscription-less plugin is fine, and events with no handlers deliver to no one", async () => {
    const host = new PluginHost();
    await host.use({ activate: () => {} });
    expect(() => {
      host.emit("initialize", emptyIface());
      host.emit("create", {} as PenguinContext);
    }).not.toThrow();
  });

  it("the subscription window seals when activate settles", async () => {
    const host = new PluginHost();
    let leaked: ((event: "create", handler: (ctx: PenguinContext) => void) => void) | null = null;
    await host.use({
      activate(extCtx) {
        leaked = (event, handler) => extCtx.on(event, handler);
      },
    });
    // A handler-time (or any later) subscription would accumulate one copy per hot
    // swap; the seal turns the leak into a loud error.
    expect(() => leaked!("create", () => {})).toThrow(/after activate settled/);
  });

  it("dispose runs disposables concurrently, awaits async ones, and isolates failures", async () => {
    const host = new PluginHost();
    const done: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    await host.use({
      activate(extCtx) {
        extCtx.disposables.push({
          dispose: async () => {
            await gate;
            done.push("slow");
          },
        });
        extCtx.disposables.push({
          dispose: () => {
            throw new Error("sync boom");
          },
        });
        extCtx.disposables.push({ dispose: () => Promise.reject(new Error("async boom")) });
        extCtx.disposables.push({
          dispose: () => {
            done.push("fast");
          },
        });
      },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const pending = host.dispose();
      // Concurrent, not sequential: the fast disposer is not queued behind the gated one.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(done).toEqual(["fast"]);
      // dispose settles only once the slowest async disposer has.
      release();
      await pending;
      expect(done).toEqual(["fast", "slow"]);
      // Both failure shapes (sync throw, rejected promise) were isolated and reported.
      expect(warn).toHaveBeenCalledTimes(2);

      // Idempotent: a second call finds no plugins and re-runs nothing.
      await host.dispose();
      expect(done).toEqual(["fast", "slow"]);
      expect(warn).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("plugin host — activation is transactional", () => {
  it("an async activate is awaited, so its rejection is an ordinary load failure", async () => {
    const host = new PluginHost();
    const order: string[] = [];
    await expect(
      host.use({
        async activate(extCtx) {
          await Promise.resolve();
          // Subscribing AFTER an await still counts as inside the window: the seal
          // waits for activate to settle, not for it to return a promise.
          extCtx.on("create", () => order.push("late-subscription-ran"));
          throw new Error("async boom");
        },
      }),
    ).rejects.toThrow(/async boom/);
    // The failed plugin is not published, so nothing it registered is ever delivered.
    host.emit("create", {} as PenguinContext);
    expect(order).toEqual([]);
  });

  it("a failed activate still runs whatever it had already registered for cleanup", async () => {
    const host = new PluginHost();
    let disposed = 0;
    await expect(
      host.use({
        activate(extCtx) {
          extCtx.disposables.push({ dispose: () => void disposed++ });
          throw new Error("boom after registering");
        },
      }),
    ).rejects.toThrow(/boom after registering/);
    // Rolled back at the failure — the entry is dropped, so dispose() could never
    // reach these, and a watcher/socket/child would leak for the process's lifetime.
    expect(disposed).toBe(1);
    await host.dispose();
    expect(disposed).toBe(1);
  });

  it("an async event handler is refused, and its rejection cannot escape", async () => {
    const host = new PluginHost();
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown): void => void rejections.push(reason);
    process.on("unhandledRejection", onRejection);
    try {
      await host.use({
        activate: (extCtx) =>
          extCtx.on("create", async () => {
            throw new Error("would-be unhandled");
          }),
      });
      expect(() => host.emit("create", {} as PenguinContext)).toThrow(
        /handler for 'create' returned a promise/,
      );
      // The refusal claims the promise, so the boot failure above is the ONLY signal —
      // an escaping rejection could otherwise kill a process still installing handlers.
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onRejection);
    }
  });
});

describe("workflows: registration and plain invocation", () => {
  it("a registered factory becomes a callable instance on the context", () => {
    const iface = emptyIface();
    iface.workflow.set("greet", () => ({ run: (input) => `hello ${String(input)}` }));
    const workflows = instantiateWorkflows(iface.workflow);
    expect(workflows.names()).toEqual(["greet"]);
    expect(workflows.run("greet", "world")).toBe("hello world");
    expect(workflows.get("greet")).toBeDefined();
  });

  it("calling an unregistered workflow says so rather than returning undefined", () => {
    const workflows = instantiateWorkflows(new Map());
    expect(() => workflows.run("nope", null)).toThrow(/no workflow named 'nope'/);
    expect(workflows.get("nope")).toBeUndefined();
  });

  it("each App creation builds fresh instances, so per-instance state never rides a swap", () => {
    const factories = new Map<string, WorkflowFactory>();
    factories.set("counter", () => {
      let n = 0;
      return { run: () => ++n };
    });
    const first = instantiateWorkflows(factories);
    expect(first.run("counter", null)).toBe(1);
    expect(first.run("counter", null)).toBe(2);
    // What a hot swap does: build the App again from the same factories.
    expect(instantiateWorkflows(factories).run("counter", null)).toBe(1);
  });

  it("a duplicate workflow name is refused, not silently replaced", () => {
    const iface = emptyIface();
    iface.workflow.set("same", () => ({ run: () => "A" }));
    // A bare Map would let the winner depend on plugins.json ordering, and a plugin
    // could take over a name another one owns without either noticing.
    expect(() => iface.workflow.set("same", () => ({ run: () => "B" }))).toThrow(
      /workflow 'same' is already registered/,
    );
    expect(instantiateWorkflows(iface.workflow).run("same", null)).toBe("A");
  });

  it("registration order is the order the names come back in", () => {
    const factories = new Map<string, WorkflowFactory>();
    for (const name of ["b", "a", "c"]) factories.set(name, () => ({ run: () => name }));
    expect(instantiateWorkflows(factories).names()).toEqual(["b", "a", "c"]);
  });
});

describe("pluginHostFrom", () => {
  it("claims the host the runtime published", () => {
    const host = new PluginHost();
    const resources = new HotResources();
    resources.register(PLUGINS_RESOURCE_ID, host);
    expect(pluginHostFrom(resources)).toBe(host);
  });

  it("falls back to an empty host when nothing was published", () => {
    const iface: PenguinInterface = emptyIface();
    // No throw, and nothing registers into the iface: no published host means no plugins.
    pluginHostFrom(new HotResources()).emit("initialize", iface);
    expect(iface.workflow.size).toBe(0);
  });
});

describe("plugin seam on the real platform", () => {
  it("boots an App when the runtime published no host at all", async () => {
    const inst = await quietBoot(bareKernel());
    try {
      expect(inst.api.info()).toMatchObject({ impl: "packaged" });
    } finally {
      inst.dispose();
    }
  });

  it("every App creation re-delivers both events, and the context carries what it registered", async () => {
    const contexts: PenguinContext[] = [];
    let initializes = 0;
    const host = new PluginHost();
    await host.use({
      activate(extCtx) {
        extCtx.on("initialize", (iface) => {
          initializes++;
          iface.workflow.set(`probe-${initializes}`, () => ({
            run: (input) => ({ echoed: input }),
          }));
        });
        extCtx.on("create", (ctx) => contexts.push(ctx));
      },
    });
    // The registry sits outside the reloadable tree and outlives a swap: publishing the
    // host once is what lets both Apps below drive the same loaded plugins.
    const resources = bareKernel();
    resources.register(PLUGINS_RESOURCE_ID, host);

    const instA = await quietBoot(resources);
    try {
      expect(initializes).toBe(1);
      expect(contexts).toHaveLength(1);
      const ctx = contexts[0]!;
      // The sandbox config surface rides the same context (see ../src/sandbox/).
      expect(ctx.sandbox.settings()).toEqual({ mode: "danger-full-access" });
      // `terminals` is NOT on the closed contract: it is this harness's own, so reaching it
      // is an explicit cast — the same one a plugin depending on this embedder writes.
      expect(typeof (ctx as HarnessContext).terminals.handleIds).toBe("function");
      // …and the workflow this plugin registered is instantiated and callable.
      expect(ctx.workflows.names()).toContain("probe-1");
      expect(ctx.workflows.run("probe-1", 42)).toEqual({ echoed: 42 });

      // A second boot is what a hot swap performs: a new App, hooks delivered again.
      const instB = await quietBoot(resources);
      try {
        expect(initializes).toBe(2);
        expect(contexts).toHaveLength(2);
        expect(contexts[1]!.workflows.names()).toContain("probe-2");
      } finally {
        instB.dispose();
      }
    } finally {
      instA.dispose();
    }
  });
});
