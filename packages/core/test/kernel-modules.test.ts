/**
 * The module tree: signature-level interface satisfaction, the manifest check that runs
 * before any code, and boot order from requires + contributions.
 */
import { describe, expect, it } from "vitest";
import type { IfaceDecl, Manifest, Resources } from "../src/kernel/index.js";
type IfaceTable = Record<string, IfaceDecl>;
import {
  assignable,
  bootModules,
  checkTree,
  Component,
  defineModule,
  Interface,
  Module,
  ModuleBootError,
  moduleDefOf,
  parseManifest,
  Provide,
  satisfies,
  Use,
  wire,
} from "../src/kernel/index.js";

const resources: Resources = {
  register: () => () => {},
  claim: () => undefined,
};

const str = { data: "string" } as const;
const num = { data: "number" } as const;

const Sessions: IfaceDecl = {
  name: "Sessions",
  methods: {
    startTask: {
      params: [
        str,
        { data: "string[]" },
        { data: [{ "queueIfBusy?": "boolean" }, "|", "undefined"] },
      ],
      returns: { promise: { data: { sessionId: "string", queued: "boolean" } } },
    },
    statusOf: { params: [str], returns: { data: "'idle'|'running'" } },
    subscribe: {
      params: [str, { fn: { params: [{ data: "string" }], returns: { void: true } } }],
      returns: { fn: { params: [], returns: { void: true } } },
    },
  },
  slots: {},
};

/** What the scheduler needs: two methods, narrower signatures. */
const Runner: IfaceDecl = {
  name: "ScheduleTaskRunner",
  methods: {
    statusOf: { params: [str], returns: { data: "string" } },
    startTask: {
      params: [str, { data: "string[]" }],
      returns: { promise: { data: { sessionId: "string" } } },
    },
  },
  slots: {},
};

describe("satisfies", () => {
  it("a wider interface satisfies a narrower one it structurally covers", () => {
    expect(satisfies(Sessions, Runner)).toEqual([]);
  });

  it("names the method and the reason when it does not", () => {
    const wrong: IfaceDecl = {
      ...Runner,
      methods: { ...Runner.methods, statusOf: { params: [num], returns: { data: "string" } } },
    };
    const gaps = satisfies(Sessions, wrong);
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ method: "statusOf", kind: "signature" });
    expect(gaps[0]!.why).toContain("param 0");
  });

  it("a missing method is reported as missing, not as a signature mismatch", () => {
    const more: IfaceDecl = {
      ...Runner,
      methods: { ...Runner.methods, abort: { params: [str], returns: { data: "boolean" } } },
    };
    expect(satisfies(Runner, more)).toEqual([
      { method: "abort", kind: "missing", why: expect.stringContaining("no method 'abort'") },
    ]);
  });

  it("parameters are contravariant and returns covariant", () => {
    // impl accepts string|number where the caller passes string: fine.
    expect(
      assignable(
        { params: [{ data: "string|number" }], returns: { data: "'a'" } },
        { params: [str], returns: { data: "string" } },
      ),
    ).toEqual([]);
    // impl returns string where the caller expects 'a': not fine.
    expect(
      assignable(
        { params: [str], returns: { data: "string" } },
        { params: [str], returns: { data: "'a'" } },
      ),
    ).toHaveLength(1);
  });

  it("an extra parameter is allowed only when optional", () => {
    const base = { params: [str], returns: { void: true as const } };
    expect(
      assignable({ params: [str, { data: "number|undefined" }], returns: { void: true } }, base),
    ).toEqual([]);
    expect(assignable({ params: [str, num], returns: { void: true } }, base)).toHaveLength(1);
  });

  it("interface-typed parameters recurse through the table, coinductively", () => {
    const table: IfaceTable = {
      "a#Node": {
        name: "Node",
        methods: { next: { params: [], returns: { iface: "a#Node" } } },
        slots: {},
      },
      "b#Node": {
        name: "Node",
        methods: { next: { params: [], returns: { iface: "b#Node" } } },
        slots: {},
      },
    };
    expect(satisfies(table["a#Node"]!, table["b#Node"]!, table)).toEqual([]);
  });

  it("opaque host objects compare by name only", () => {
    const sig = (name: string) => ({
      params: [{ opaque: name }],
      returns: { void: true as const },
    });
    expect(assignable(sig("AbortSignal"), sig("AbortSignal"))).toEqual([]);
    expect(assignable(sig("AbortSignal"), sig("Request"))).toHaveLength(1);
  });
});

const table: IfaceTable = {
  "sessions#Sessions": Sessions,
  "scheduler#ScheduleTaskRunner": Runner,
  "http#Http": {
    name: "Http",
    methods: {
      handle: { params: [{ opaque: "Request" }], returns: { promise: { opaque: "Response" } } },
    },
    slots: {
      routes: { data: { prefix: "string", auth: "'admin'|'user'" }, code: { opaque: "Handler" } },
    },
  },
};

const manifest = (m: Partial<Manifest> & { name: string }): Manifest =>
  parseManifest({ requires: {}, provides: {}, contributes: {}, children: [], ...m });

const platform = manifest({ name: "platform", children: ["http", "sessions", "scheduler"] });
const http = manifest({ name: "http", provides: { http: "Http" } });
const sessions = manifest({
  name: "sessions",
  provides: { sessions: "Sessions" },
  contributes: {
    "http.routes": [{ id: "sessions.routes", prefix: "/api/sessions", auth: "user" }],
  },
});
const scheduler = manifest({
  name: "scheduler",
  requires: { runner: { iface: "ScheduleTaskRunner", from: "sessions" } },
});

const tree = (...children: Manifest[]) => ({
  manifest: platform,
  children: children.map((manifest) => ({ manifest, children: [] })),
});

describe("checkTree", () => {
  it("passes a consistent tree", () => {
    expect(checkTree(tree(http, sessions, scheduler), table).problems).toEqual([]);
  });

  it("reports a requirement no visible module satisfies, by method", () => {
    const wrong = {
      ...table,
      "scheduler#ScheduleTaskRunner": {
        ...Runner,
        methods: { ...Runner.methods, abort: Runner.methods.statusOf! },
      },
    };
    const { problems } = checkTree(tree(http, sessions, scheduler), wrong);
    expect(problems).toEqual([
      expect.objectContaining({
        kind: "mismatch",
        alias: "runner",
        from: "sessions",
        method: "abort",
      }),
    ]);
  });

  it("resolves an unnamed `from` when exactly one visible provider satisfies", () => {
    const loose = manifest({
      name: "scheduler",
      requires: { runner: { iface: "ScheduleTaskRunner" } },
    });
    expect(checkTree(tree(http, sessions, loose), table).problems).toEqual([]);
  });

  it("a contribution to a slot nobody declares, or one that fails the slot schema, is a problem", () => {
    const bad = manifest({
      name: "sessions",
      provides: { sessions: "Sessions" },
      contributes: {
        "http.nope": [{ id: "x" }],
        "http.routes": [{ id: "sessions.routes", prefix: "/api", auth: "root" }],
      },
    });
    const { problems } = checkTree(tree(http, bad, scheduler), table);
    expect(problems.map((p) => p.kind).sort()).toEqual(["bad-contribution", "no-such-slot"]);
  });

  it("visibility is lexical: a module cannot wire to another subtree's child", () => {
    const inner = manifest({ name: "inner", provides: { sessions: "Sessions" } });
    const outer = manifest({ name: "outer", children: ["inner"] });
    const root = {
      manifest: platform,
      children: [
        { manifest: outer, children: [{ manifest: inner, children: [] }] },
        {
          manifest: manifest({
            name: "scheduler",
            requires: { runner: { iface: "ScheduleTaskRunner", from: "inner" } },
          }),
          children: [],
        },
      ],
    };
    const t = { ...table, "inner#Sessions": Sessions };
    expect(checkTree(root, t).problems).toEqual([
      expect.objectContaining({ kind: "unresolved", why: "not visible from here" }),
    ]);
  });
});

describe("bootModules", () => {
  const sessionsApi = {
    startTask: async () => ({ sessionId: "s", queued: false }),
    statusOf: () => "idle",
    subscribe: () => () => {},
  };

  it("boots in dependency order and hands contributions with their code half", async () => {
    const order: string[] = [];
    const root = defineModule(platform, {
      create: () => ({ api: {} }),
      children: [
        defineModule(scheduler, {
          create(ctx) {
            order.push("scheduler");
            expect(typeof (ctx.use.runner as { statusOf: unknown }).statusOf).toBe("function");
            return { api: {} };
          },
        }),
        defineModule(http, {
          create(ctx) {
            order.push("http");
            expect(ctx.contributions.routes).toEqual([
              {
                id: "sessions.routes",
                from: "sessions",
                data: { prefix: "/api/sessions", auth: "user" },
                code: "HANDLER",
              },
            ]);
            return { api: { http: { handle: async () => null } } };
          },
        }),
        defineModule(sessions, {
          create() {
            order.push("sessions");
            return { api: { sessions: sessionsApi }, bind: { "sessions.routes": "HANDLER" } };
          },
        }),
      ],
    });
    const booted = await bootModules(root, { ifaces: table, resources });
    expect(order).toEqual(["sessions", "scheduler", "http"]);
    expect(booted.api("sessions", "sessions")).toBe(sessionsApi);
    booted.dispose();
  });

  it("refuses a declared-but-unbound contribution", async () => {
    const root = defineModule(platform, {
      create: () => ({ api: {} }),
      children: [
        defineModule(http, { create: () => ({ api: { http: { handle: async () => null } } }) }),
        defineModule(sessions, { create: () => ({ api: { sessions: sessionsApi } }) }),
        defineModule(scheduler, { create: () => ({ api: {} }) }),
      ],
    });
    await expect(bootModules(root, { ifaces: table, resources })).rejects.toThrow(
      /declared but not bound/,
    );
  });

  it("refuses an api that lacks a method the interface names", async () => {
    const bare = manifest({ name: "sessions", provides: { sessions: "Sessions" } });
    const root = defineModule(manifest({ name: "platform", children: ["sessions"] }), {
      create: () => ({ api: {} }),
      children: [
        defineModule(bare, { create: () => ({ api: { sessions: { statusOf: () => "idle" } } }) }),
      ],
    });
    const t = { ...table };
    await expect(bootModules(root, { ifaces: t, resources })).rejects.toThrow(
      /missing \[startTask, subscribe\]/,
    );
  });

  it("names the modules in a dependency cycle", async () => {
    const a = manifest({
      name: "a",
      provides: { s: "Sessions" },
      requires: { r: { iface: "ScheduleTaskRunner", from: "b" } },
    });
    const b = manifest({
      name: "b",
      provides: { s: "Sessions" },
      requires: { r: { iface: "ScheduleTaskRunner", from: "a" } },
    });
    const t: IfaceTable = {
      "a#Sessions": Sessions,
      "b#Sessions": Sessions,
      "a#ScheduleTaskRunner": Runner,
      "b#ScheduleTaskRunner": Runner,
    };
    const root = defineModule(manifest({ name: "platform", children: ["a", "b"] }), {
      create: () => ({ api: {} }),
      children: [
        defineModule(a, { create: () => ({ api: { s: sessionsApi } }) }),
        defineModule(b, { create: () => ({ api: { s: sessionsApi } }) }),
      ],
    });
    await expect(bootModules(root, { ifaces: t, resources })).rejects.toThrow(
      /cycle: .*a → b → a|cycle: .*b → a → b/,
    );
  });

  it("parks per module, versioned, and migrates on the way back in", async () => {
    const mf = manifest({ name: "counter", context: { version: 2, schema: { n: "number" } } });
    const make = (seen: { context: unknown }) =>
      defineModule(manifest({ name: "platform", children: ["counter"] }), {
        create: () => ({ api: {} }),
        children: [
          defineModule(mf, {
            migrations: { 1: (old) => ({ n: typeof old === "number" ? old : 0 }) },
            create(_ctx, context) {
              seen.context = context;
              return { api: {}, park: () => ({ n: 7 }) };
            },
          }),
        ],
      });
    const seen = { context: null as unknown };
    const first = await bootModules(make(seen), { ifaces: {}, resources });
    expect(seen.context).toBeNull();
    const parked = first.park();
    expect(parked).toEqual({ counter: { v: 2, self: { n: 7 } } });
    const second = await bootModules(make(seen), { ifaces: {}, resources, parked });
    expect(seen.context).toEqual({ n: 7 });
    second.dispose();
    // A v1 document (a bare number) goes through the migration.
    await bootModules(make(seen), {
      ifaces: {},
      resources,
      parked: { counter: { v: 1, self: 3 } },
    });
    expect(seen.context).toEqual({ n: 3 });
    await expect(
      bootModules(make(seen), {
        ifaces: {},
        resources,
        parked: { counter: { v: 2, self: { n: "x" } } },
      }),
    ).rejects.toThrow(ModuleBootError);
  });
});

describe("Interface, in both spellings", () => {
  // The interface declares its own members.
  @Interface()
  abstract class Clock {
    abstract now(): number;
  }
  // The interface IS an existing type.
  type StoreShape = { get(key: string): string | undefined };
  abstract class Store extends Interface<StoreShape>() {}

  it("is a runtime handle either way, so a manifest can name it by reference", () => {
    expect(typeof Clock).toBe("function");
    expect(Clock.name).toBe("Clock");
    expect(typeof Store).toBe("function");
  });

  it("types a consumer the same either way", () => {
    class RealClock {
      now() {
        return 7;
      }
    }
    const satisfiesClock: RealClock extends Clock ? true : never = true;
    const store: Store = { get: (k) => (k === "a" ? "1" : undefined) };
    expect(satisfiesClock).toBe(true);
    expect(store.get("a")).toBe("1");
    const clock: Clock = new RealClock();
    expect(clock.now()).toBe(7);
  });
});

describe("class form: @Module / @Use / @Provide / @Bind", () => {
  abstract class Sessions extends Interface<{
    startTask(id: string): Promise<{ sessionId: string }>;
    statusOf(id: string): string;
  }>() {}
  abstract class Runner extends Interface<{ statusOf(id: string): string }>() {}
  const t: IfaceTable = {
    "SessionsModule#Sessions": {
      name: "Sessions",
      methods: {
        startTask: { params: [str], returns: { promise: { data: { sessionId: "string" } } } },
        statusOf: { params: [str], returns: { data: "string" } },
      },
      slots: {},
    },
    "SchedulerModule#Runner": {
      name: "Runner",
      methods: { statusOf: { params: [str], returns: { data: "string" } } },
      slots: {},
    },
  };
  /** What the generator would have extracted from the classes below. */
  const manifests = {
    SessionsModule: parseManifest({
      name: "SessionsModule",
      requires: {},
      provides: { sessions: "Sessions" },
      contributes: {},
      children: [],
    }),
    SchedulerModule: parseManifest({
      name: "SchedulerModule",
      requires: { runner: { iface: "Runner", from: "SessionsModule" } },
      provides: {},
      contributes: {},
      children: [],
    }),
    PlatformModule: parseManifest({
      name: "PlatformModule",
      requires: {},
      provides: {},
      contributes: {},
      children: ["SessionsModule", "SchedulerModule"],
    }),
  };
  @Module()
  class SessionsModule {
    @Provide() sessions!: Sessions;
    setup() {
      this.sessions = {
        startTask: async (id: string) => ({ sessionId: id }),
        statusOf: () => "idle",
      };
    }
  }
  const seen: string[] = [];
  @Module()
  class SchedulerModule {
    @Use(SessionsModule) readonly runner!: Runner;
    setup() {
      seen.push(this.runner.statusOf("s")); // typed by the field: Runner
    }
  }
  @Module({ children: [SessionsModule, SchedulerModule] })
  class PlatformModule {
    setup() {}
  }

  it("boots a class tree against the generated manifests, injecting @Use and reading @Provide", async () => {
    const def = moduleDefOf(PlatformModule, { manifests });
    expect(def.manifest.children).toEqual(["SessionsModule", "SchedulerModule"]);
    const tree = await bootModules(def, { ifaces: t, resources });
    expect(seen).toEqual(["idle"]);
    expect(typeof tree.api<Sessions>("SessionsModule", "sessions").startTask).toBe("function");
    tree.dispose();
  });

  it("a @Use field the table does not know is a stale-table error, named", () => {
    @Module()
    class Drifted {
      @Use(SessionsModule) readonly runner!: Runner;
      @Use(SessionsModule) readonly extra!: Sessions;
      setup() {}
    }
    expect(() =>
      moduleDefOf(Drifted, { manifests: { ...manifests, Drifted: manifests.SchedulerModule! } }),
    ).toThrow(/@Use field 'extra' is not a requirement in the table/);
  });

  it("a @Provide field setup() leaves unassigned refuses the boot", async () => {
    @Module()
    class Forgetful {
      @Provide() sessions!: Sessions;
      setup() {}
    }
    const def = moduleDefOf(Forgetful, {
      manifests: { ...manifests, Forgetful: manifests.SessionsModule! },
    });
    await expect(
      def.create({ use: {}, contributions: {}, resources, effect: () => {} }, null),
    ).rejects.toThrow(/left @Provide field 'sessions' unassigned/);
  });

  it("a @Component provides itself: its instance is the api, named by its class", async () => {
    const withComponent = {
      ...manifests,
      // A component's key is `<name>#<Class>`; the class is its own interface.
      SessionRunner: parseManifest({
        name: "SessionRunner",
        requires: {},
        provides: { SessionRunner: "test#SessionRunner" },
        contributes: {},
        children: [],
      }),
      SchedulerModule: parseManifest({
        name: "SchedulerModule",
        // A bare @Use() typed by a component is wired to that component by the generator.
        requires: { runner: { iface: "Runner", from: "SessionRunner" } },
        provides: {},
        contributes: {},
        children: [],
      }),
      PlatformModule: parseManifest({
        name: "PlatformModule",
        requires: {},
        provides: {},
        contributes: {},
        children: ["SessionRunner", "SchedulerModule"],
      }),
    };
    const table = {
      ...t,
      "test#SessionRunner": {
        name: "SessionRunner",
        methods: { statusOf: { params: [str], returns: { data: "string" } } },
        slots: {},
      },
    };
    const calls: string[] = [];
    @Component()
    class SessionRunner {
      statusOf(id: string): string {
        calls.push(id);
        return "idle";
      }
      // no setup(): a component may be a plain class
    }
    @Module()
    class SchedulerModule {
      @Use() readonly runner!: Runner;
      setup() {
        this.runner.statusOf("s");
      }
    }
    @Module({ children: [SessionRunner, SchedulerModule] })
    class PlatformModule {}
    const def = moduleDefOf(PlatformModule, { manifests: withComponent });
    const tree = await bootModules(def, { ifaces: table, resources });
    expect(calls).toEqual(["s"]);
    expect(tree.api<SessionRunner>("SessionRunner", "SessionRunner")).toBeInstanceOf(SessionRunner);
    tree.dispose();
  });

  it("a @Component the table does not list as providing itself is a stale-table error", () => {
    @Component()
    class Sneaky {}
    expect(() =>
      moduleDefOf(Sneaky, { manifests: { ...manifests, Sneaky: manifests.SessionsModule! } }),
    ).toThrow(/component 'Sneaky' does not provide itself in the table/);
  });

  it("an explicit @Use(From) that disagrees with the table is named", () => {
    @Module()
    class Miswired {
      @Use(SchedulerModule) readonly runner!: Runner;
      setup() {}
    }
    expect(() =>
      moduleDefOf(Miswired, { manifests: { ...manifests, Miswired: manifests.SchedulerModule! } }),
    ).toThrow(/wired to 'SchedulerModule' in code, 'SessionsModule' in the table/);
  });

  it("wire() builds a component outside a tree with its fields supplied by hand", () => {
    @Component()
    class Counter {
      @Use() private readonly runner!: Runner;
      status(): string {
        return this.runner.statusOf("x");
      }
    }
    const c = wire(Counter, { runner: { statusOf: () => "busy" } });
    expect(c.status()).toBe("busy");
    expect(c).toBeInstanceOf(Counter);
  });

  it("an undecorated class is refused by name", () => {
    class Plain {
      setup() {}
    }
    @Module({ children: [Plain] })
    class X {
      setup() {}
    }
    expect(() =>
      moduleDefOf(X, {
        manifests: {
          ...manifests,
          X: parseManifest({
            name: "X",
            requires: {},
            provides: {},
            contributes: {},
            children: [],
          }),
        },
      }),
    ).toThrow(/'Plain' is not a @Module/);
  });
});
