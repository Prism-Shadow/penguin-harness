/**
 * Verified, runnable documentation samples for `@Module` (`ModuleMeta`) options.
 *
 * Every `// #docregion <Symbol.member>` block is kept short, pure user code
 * (zero test-harness variables inside `#docregion`), annotated with inline
 * comments and `// @focus` markers on the exact option lines being shown.
 *
 * `run-doc-samples.mjs` type-checks this file with `ts.createProgram` (strict),
 * extracts real semantic tokens + Go-to-Def + Peek Definitions via TypeChecker,
 * and executes every runtime assertion against `packages/core/src/kernel/index.ts`.
 */
import assert from "node:assert/strict";
import {
  Bind,
  Component,
  Interface,
  Module,
  ModuleBootError,
  Provide,
  Use,
  bootModules,
  moduleDefOf,
  parseManifest,
  type ClassCtx,
  type Contributed,
  type Json,
  type Resources,
  type TableLike,
} from "../../worktrees/refs-main/packages/core/src/kernel/index.js";

const emptyResources = (): Resources => ({
  register: () => () => {},
  claim: () => undefined,
});

const str = { data: "string" as const };

export interface SampleResult {
  key: string;
  title: string;
  assertions: number;
}

const results: SampleResult[] = [];

async function verify(
  key: string,
  title: string,
  fn: () => Promise<number> | number,
): Promise<void> {
  const assertions = await fn();
  results.push({ key, title, assertions });
}

/* ------------------------------------------------------------------ */
/* 1. ModuleMeta.contributes                                          */
/* ------------------------------------------------------------------ */
/**
 * @docTarget ModuleMeta.contributes
 * Declares pure-JSON contribution entries targeting `<HostModule>.<slot>` slots on another module's `*Slots` interface. Each entry requires a unique `id`; for a code-carrying `Slot<Data, Code>`, bind the live implementation on a field with `@Bind(id)` in `setup()` — the booter guarantees this module boots before the slot host.
 */
await verify(
  "ModuleMeta.contributes",
  "contributes delivers manifest data + @Bind code half before slot host boots",
  async () => {
    interface RouteHandler {
      handle(path: string): string;
    }

    let received: Contributed[] = [];

    // #docregion ModuleMeta.contributes
    @Module({
      // Target "<HostModule>.<slot>"; each entry needs a unique `id`
      contributes: { // [!code highlight]
        "HttpModule.routes": [{ id: "admin.routes", prefix: "/api/admin" }], // [!code highlight]
      }, // [!code highlight]
    })
    class AdminModule {
      // Code half for the entry above — ready before HttpModule boots
      @Bind("admin.routes") routes!: RouteHandler;

      setup() {
        this.routes = { handle: (path) => `admin:${path}` };
      }
    }
    // #enddocregion ModuleMeta.contributes

    @Module()
    class HttpModule {
      @Provide() slots!: Record<string, never>;

      setup(ctx: ClassCtx) {
        this.slots = {};
        received = ctx.contributions.routes ?? [];
      }
    }

    @Module({ children: [HttpModule, AdminModule] })
    class AppModule {}

    const ifaces: TableLike = {
      "HttpModule#HttpSlots": {
        name: "HttpSlots",
        methods: {},
        slots: {
          routes: {
            data: { prefix: "string" },
            code: { opaque: "docs#RouteHandler" },
          },
        },
      },
    };

    const manifests = {
      HttpModule: parseManifest({
        name: "HttpModule",
        requires: {},
        provides: { slots: "HttpSlots" },
        contributes: {},
        children: [],
      }),
      AdminModule: parseManifest({
        name: "AdminModule",
        requires: {},
        provides: {},
        contributes: {
          "HttpModule.routes": [{ id: "admin.routes", prefix: "/api/admin" }],
        },
        children: [],
      }),
      AppModule: parseManifest({
        name: "AppModule",
        requires: {},
        provides: {},
        contributes: {},
        children: ["HttpModule", "AdminModule"],
      }),
    };

    const tree = await bootModules(moduleDefOf(AppModule, { manifests }), {
      ifaces,
      resources: emptyResources(),
    });
    try {
      assert.equal(received.length, 1);
      assert.equal(received[0].from, "AdminModule");
      assert.equal((received[0].data as { prefix: string }).prefix, "/api/admin");
      // Proves AdminModule.setup() ran and bound `routes` before HttpModule.setup()
      assert.equal((received[0].code as RouteHandler).handle("/users"), "admin:/users");
    } finally {
      tree.dispose();
    }
    return 4;
  },
);

/* ------------------------------------------------------------------ */
/* 2. ModuleMeta.context                                              */
/* ------------------------------------------------------------------ */
/**
 * @docTarget ModuleMeta.context
 * Declares the versioned JSON schema (`{ version, schema? }`) for state returned by `park()` across hot upgrades. On reboot, older parked documents run through `migrations[v]`, are validated against `schema` (arktype syntax), and arrive as the second argument to `setup(ctx, saved)`.
 */
await verify(
  "ModuleMeta.context",
  "context parks versioned state, migrates v1 → v2, and rejects invalid schema",
  async () => {
    // #docregion ModuleMeta.context
    @Module({
      // Versioned JSON schema validated on hot-upgrade restore
      context: { version: 2, schema: { count: "number" } }, // [!code highlight]
    })
    class CounterModule {
      count = 0;

      // Upgrade legacy v1 parked documents before setup() runs
      migrations = { 1: (old: Json) => ({ count: Number(old) || 0 }) };

      setup(_ctx: ClassCtx, saved: Json) {
        this.count = (saved as { count?: number } | null)?.count ?? 0;
      }

      park(): Json {
        return { count: this.count };
      }
    }
    // #enddocregion ModuleMeta.context

    @Module({ children: [CounterModule] })
    class AppModule {}

    const manifests = {
      CounterModule: parseManifest({
        name: "CounterModule",
        requires: {},
        provides: {},
        contributes: {},
        context: { version: 2, schema: { count: "number" } },
        children: [],
      }),
      AppModule: parseManifest({
        name: "AppModule",
        requires: {},
        provides: {},
        contributes: {},
        children: ["CounterModule"],
      }),
    };

    const inst1 = new CounterModule();
    const first = await bootModules(
      moduleDefOf(AppModule, { manifests, instances: new Map([[CounterModule, inst1]]) }),
      { ifaces: {}, resources: emptyResources() },
    );
    assert.equal(inst1.count, 0);
    inst1.count = 42;
    const parked = first.park();
    assert.deepEqual(parked, { CounterModule: { v: 2, self: { count: 42 } } });
    first.dispose();

    const inst2 = new CounterModule();
    const second = await bootModules(
      moduleDefOf(AppModule, { manifests, instances: new Map([[CounterModule, inst2]]) }),
      { ifaces: {}, resources: emptyResources(), parked },
    );
    assert.equal(inst2.count, 42);
    second.dispose();

    const inst3 = new CounterModule();
    const migrated = await bootModules(
      moduleDefOf(AppModule, { manifests, instances: new Map([[CounterModule, inst3]]) }),
      { ifaces: {}, resources: emptyResources(), parked: { CounterModule: { v: 1, self: 7 } } },
    );
    assert.equal(inst3.count, 7);
    migrated.dispose();

    await assert.rejects(
      bootModules(moduleDefOf(AppModule, { manifests }), {
        ifaces: {},
        resources: emptyResources(),
        parked: { CounterModule: { v: 2, self: { count: "bad" } } },
      }),
      ModuleBootError,
    );
    return 5;
  },
);

/* ------------------------------------------------------------------ */
/* 3. ModuleMeta.children                                             */
/* ------------------------------------------------------------------ */
/**
 * @docTarget ModuleMeta.children
 * Lists child `@Module` and `@Component` classes owned by this subtree. The booter orders them topologically by `@Use` and `Slot<Data, Code>` dependencies (regardless of array order) and disposes in reverse; children stay private unless forwarded via `exports`.
 */
await verify(
  "ModuleMeta.children",
  "children boot topologically by @Use dependency and dispose in reverse order",
  async () => {
    @Interface()
    abstract class Runner {
      abstract statusOf(id: string): string;
    }

    const events: string[] = [];

    @Module()
    class SessionsModule {
      @Provide() runner!: Runner;

      setup(ctx: ClassCtx) {
        events.push("boot:SessionsModule");
        ctx.effect(() => events.push("dispose:SessionsModule"));
        this.runner = { statusOf: () => "idle" };
      }
    }

    @Module()
    class SchedulerModule {
      @Use(SessionsModule) readonly runner!: Runner;

      setup(ctx: ClassCtx) {
        events.push(`boot:SchedulerModule:${this.runner.statusOf("job-1")}`);
        ctx.effect(() => events.push("dispose:SchedulerModule"));
      }
    }

    // #docregion ModuleMeta.children
    @Module({
      // Order in array does not matter: SessionsModule boots before SchedulerModule
      children: [SchedulerModule, SessionsModule], // [!code highlight]
    })
    class PlatformModule {}
    // #enddocregion ModuleMeta.children

    const ifaces: TableLike = {
      "SessionsModule#Runner": {
        name: "Runner",
        methods: { statusOf: { params: [str], returns: str } },
        slots: {},
      },
      "SchedulerModule#Runner": {
        name: "Runner",
        methods: { statusOf: { params: [str], returns: str } },
        slots: {},
      },
    };

    const manifests = {
      SessionsModule: parseManifest({
        name: "SessionsModule",
        requires: {},
        provides: { runner: "Runner" },
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
        children: ["SchedulerModule", "SessionsModule"],
      }),
    };

    const def = moduleDefOf(PlatformModule, { manifests });
    assert.deepEqual(def.manifest.children, ["SchedulerModule", "SessionsModule"]);
    const tree = await bootModules(def, { ifaces, resources: emptyResources() });
    assert.deepEqual(events, ["boot:SessionsModule", "boot:SchedulerModule:idle"]);
    tree.dispose();
    assert.deepEqual(events, [
      "boot:SessionsModule",
      "boot:SchedulerModule:idle",
      "dispose:SchedulerModule",
      "dispose:SessionsModule",
    ]);
    return 3;
  },
);

/* ------------------------------------------------------------------ */
/* 4. ModuleMeta.exports                                              */
/* ------------------------------------------------------------------ */
/**
 * @docTarget ModuleMeta.exports
 * Interfaces this module forwards from its children — what the subtree offers outside. Sibling modules can `@Use` exported interfaces from this module, while unexported children remain encapsulated inside the subtree.
 */
await verify(
  "ModuleMeta.exports",
  "exports forwards Users outside IdentityModule while keeping InternalCache private",
  async () => {
    @Interface()
    abstract class Users {
      abstract find(id: string): string;
    }

    @Interface()
    abstract class Cache {
      abstract get(key: string): string;
    }

    @Component()
    class UsersRepo implements Users {
      find(id: string): string {
        return id === "u1" ? "Ada" : "unknown";
      }
    }

    @Component()
    class InternalCache implements Cache {
      get(key: string): string {
        return `cached:${key}`;
      }
    }

    // #docregion ModuleMeta.exports
    @Module({
      children: [UsersRepo, InternalCache],
      // Only Users is visible to siblings; InternalCache stays private
      exports: [Users], // [!code highlight]
    })
    class IdentityModule {}
    // #enddocregion ModuleMeta.exports

    let foundUser = "";

    @Module()
    class AuditModule {
      @Use(IdentityModule) readonly users!: Users;

      setup() {
        foundUser = this.users.find("u1");
      }
    }

    @Module({ children: [IdentityModule, AuditModule] })
    class PlatformModule {}

    const ifaces: TableLike = {
      "UsersRepo#Users": { name: "Users", methods: { find: { params: [str], returns: str } }, slots: {} },
      "UsersRepo#UsersRepo": { name: "UsersRepo", methods: { find: { params: [str], returns: str } }, slots: {} },
      "InternalCache#Cache": { name: "Cache", methods: { get: { params: [str], returns: str } }, slots: {} },
      "InternalCache#InternalCache": { name: "InternalCache", methods: { get: { params: [str], returns: str } }, slots: {} },
      "IdentityModule#Users": { name: "Users", methods: { find: { params: [str], returns: str } }, slots: {} },
      "AuditModule#Users": { name: "Users", methods: { find: { params: [str], returns: str } }, slots: {} },
      "LeakyModule#Cache": { name: "Cache", methods: { get: { params: [str], returns: str } }, slots: {} },
    };

    const manifests = {
      UsersRepo: parseManifest({
        name: "UsersRepo",
        requires: {},
        provides: { UsersRepo: "UsersRepo", Users: "Users" },
        contributes: {},
        children: [],
      }),
      InternalCache: parseManifest({
        name: "InternalCache",
        requires: {},
        provides: { InternalCache: "InternalCache", Cache: "Cache" },
        contributes: {},
        children: [],
      }),
      IdentityModule: parseManifest({
        name: "IdentityModule",
        requires: {},
        provides: { Users: "Users" },
        exports: ["Users"],
        contributes: {},
        children: ["UsersRepo", "InternalCache"],
      }),
      AuditModule: parseManifest({
        name: "AuditModule",
        requires: { users: { iface: "Users", from: "IdentityModule" } },
        provides: {},
        contributes: {},
        children: [],
      }),
      PlatformModule: parseManifest({
        name: "PlatformModule",
        requires: {},
        provides: {},
        contributes: {},
        children: ["IdentityModule", "AuditModule"],
      }),
    };

    const tree = await bootModules(moduleDefOf(PlatformModule, { manifests }), {
      ifaces,
      resources: emptyResources(),
    });
    assert.equal(foundUser, "Ada");
    tree.dispose();

    @Module()
    class LeakyModule {
      @Use() readonly cache!: Cache;
    }

    @Module({ children: [IdentityModule, LeakyModule] })
    class BrokenPlatform {}

    await assert.rejects(
      bootModules(
        moduleDefOf(BrokenPlatform, {
          manifests: {
            ...manifests,
            LeakyModule: parseManifest({
              name: "LeakyModule",
              requires: { cache: { iface: "Cache" } },
              provides: {},
              contributes: {},
              children: [],
            }),
            BrokenPlatform: parseManifest({
              name: "BrokenPlatform",
              requires: {},
              provides: {},
              contributes: {},
              children: ["IdentityModule", "LeakyModule"],
            }),
          },
        }),
        { ifaces, resources: emptyResources() },
      ),
      ModuleBootError,
    );
    return 2;
  },
);

console.log(JSON.stringify({ ok: true, results }));
