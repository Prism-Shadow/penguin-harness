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
import {
  PLUGINS_RESOURCE_ID,
  PluginHost,
  pluginHostFrom,
  type PenguinContext,
  type PenguinInterface,
} from "../src/plugin/index.js";
import { instantiateWorkflows, type WorkflowFactory } from "../src/plugin/workflow.js";

function emptyIface(): PenguinInterface {
  return { workflow: new Map(), tool: new Map(), sandbox: { registerProvider: () => {} } };
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
  it("activate runs once; typed events deliver both views in activation order", () => {
    const host = new PluginHost();
    const log: string[] = [];
    let activations = 0;
    let seenIface: PenguinInterface | null = null;
    let seenCtx: PenguinContext | null = null;
    host.use({
      activate(pluginCtx) {
        activations++;
        pluginCtx.on("initialize", (iface) => {
          seenIface = iface;
          log.push("a:initialize");
        });
        pluginCtx.on("create", (ctx) => {
          seenCtx = ctx;
          log.push("a:create");
        });
      },
    });
    host.use({ activate: (pluginCtx) => pluginCtx.on("create", () => log.push("b:create")) });

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

  it("a subscription-less plugin is fine, and events with no handlers deliver to no one", () => {
    const host = new PluginHost();
    host.use({ activate: () => {} });
    expect(() => {
      host.emit("initialize", emptyIface());
      host.emit("create", {} as PenguinContext);
    }).not.toThrow();
  });

  it("the subscription window seals when activate returns", () => {
    const host = new PluginHost();
    let leaked: ((event: "create", handler: (ctx: PenguinContext) => void) => void) | null = null;
    host.use({
      activate(pluginCtx) {
        leaked = (event, handler) => pluginCtx.on(event, handler);
      },
    });
    // A handler-time (or any later) subscription would accumulate one copy per hot
    // swap; the seal turns the leak into a loud error.
    expect(() => leaked!("create", () => {})).toThrow(/after activate returned/);
  });

  it("disposables registered in activate run at dispose, newest first", () => {
    const host = new PluginHost();
    const order: string[] = [];
    host.use({
      activate(pluginCtx) {
        pluginCtx.disposables.push({ dispose: () => order.push("a1") });
        pluginCtx.disposables.push({ dispose: () => order.push("a2") });
      },
    });
    host.use({
      activate(pluginCtx) {
        pluginCtx.disposables.push({
          dispose: () => {
            order.push("b1");
            throw new Error("must not strand the rest");
          },
        });
      },
    });
    host.dispose();
    expect(order).toEqual(["b1", "a2", "a1"]);
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
    host.use({
      activate(pluginCtx) {
        pluginCtx.on("initialize", (iface) => {
          initializes++;
          iface.workflow.set(`probe-${initializes}`, () => ({
            run: (input) => ({ echoed: input }),
          }));
        });
        pluginCtx.on("create", (ctx) => contexts.push(ctx));
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
      // context.* flatten: the platform's own member is directly on the context.
      expect(typeof ctx.terminals.handleIds).toBe("function");
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
