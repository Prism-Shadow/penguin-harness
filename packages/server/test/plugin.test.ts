/**
 * Behavior tests for the plugin seam: the two hooks and their ordering, the two views
 * (definition iface / flattened instance context), workflow registration and calling,
 * and re-delivery on the boot a hot swap performs.
 */
import { describe, expect, it } from "vitest";
import { boot, initialDoc } from "@prismshadow/penguin-core/kernel";
import { HotResources } from "../src/hmr/resources.js";
import { packagedPlatform } from "../src/hmr/platform.js";
import {
  PLUGINS_RESOURCE_ID,
  PluginHost,
  instantiateWorkflows,
  pluginHostFrom,
  type PenguinContext,
  type PenguinInterface,
  type WorkflowFactory,
} from "../src/hmr/plugin.js";

function emptyIface(): PenguinInterface {
  return { workflow: new Map(), tool: new Map() };
}

describe("plugin host", () => {
  it("delivers onCreateApp with the definition view and events with the instance view, in registration order", () => {
    const host = new PluginHost();
    const log: string[] = [];
    let seenIface: PenguinInterface | null = null;
    let seenCtx: PenguinContext | null = null;
    host.use({
      onCreateApp: (iface) => {
        seenIface = iface;
        log.push("a:create-app");
      },
      subscribe: (eventName, ctx) => {
        seenCtx = ctx;
        log.push(`a:${eventName}`);
      },
    });
    host.use({ subscribe: (eventName) => log.push(`b:${eventName}`) });

    const iface = emptyIface();
    host.createApp(iface);
    const ctx = { workflows: instantiateWorkflows(iface.workflow) } as PenguinContext;
    host.emit("create", ctx);

    expect(log).toEqual(["a:create-app", "a:create", "b:create"]);
    expect(seenIface).toBe(iface);
    expect(seenCtx).toBe(ctx);
  });

  it("a hook-less plugin is fine (both hooks optional)", () => {
    const host = new PluginHost();
    host.use({});
    expect(() => {
      host.createApp(emptyIface());
      host.emit("create", {} as PenguinContext);
    }).not.toThrow();
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
    pluginHostFrom(new HotResources()).createApp(iface);
    expect(iface.workflow.size).toBe(0);
  });
});

describe("plugin seam on the real platform", () => {
  it("boots an App when the runtime published no host at all", async () => {
    const inst = await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, packagedPlatform.context),
      new HotResources(),
    );
    try {
      expect(inst.api.info()).toMatchObject({ impl: "packaged" });
    } finally {
      inst.dispose();
    }
  });

  it("every App creation re-delivers both hooks, and the context carries what it registered", async () => {
    const events: Array<{ name: string; ctx: PenguinContext }> = [];
    let createApps = 0;
    const host = new PluginHost();
    host.use({
      onCreateApp: (iface) => {
        createApps++;
        iface.workflow.set(`probe-${createApps}`, () => ({ run: (input) => ({ echoed: input }) }));
      },
      subscribe: (name, ctx) => events.push({ name, ctx }),
    });
    // The registry sits outside the reloadable tree and outlives a swap: publishing the
    // host once is what lets both Apps below drive the same loaded plugins.
    const resources = new HotResources();
    resources.register(PLUGINS_RESOURCE_ID, host);

    const instA = await boot(
      packagedPlatform.impl,
      packagedPlatform.iface,
      initialDoc(packagedPlatform.iface, packagedPlatform.context),
      resources,
    );
    try {
      expect(createApps).toBe(1);
      expect(events.map((e) => e.name)).toEqual(["create"]);
      const ctx = events[0]!.ctx;
      // context.* flatten: the platform's own member is directly on the context.
      expect(typeof ctx.terminals.handleIds).toBe("function");
      // …and the workflow this plugin registered is instantiated and callable.
      expect(ctx.workflows.names()).toContain("probe-1");
      expect(ctx.workflows.run("probe-1", 42)).toEqual({ echoed: 42 });

      // A second boot is what a hot swap performs: a new App, hooks delivered again.
      const instB = await boot(
        packagedPlatform.impl,
        packagedPlatform.iface,
        initialDoc(packagedPlatform.iface, packagedPlatform.context),
        resources,
      );
      try {
        expect(createApps).toBe(2);
        expect(events).toHaveLength(2);
        expect(events[1]!.ctx.workflows.names()).toContain("probe-2");
      } finally {
        instB.dispose();
      }
    } finally {
      instA.dispose();
    }
  });
});
