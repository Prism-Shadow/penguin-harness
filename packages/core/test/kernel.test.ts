/**
 * Kernel unit tests: the three upgrade-ladder paths (silent / migrated /
 * blocked), the boot-time method-set check, keyed collections, resource
 * claiming across an upgrade, and effect draining on dispose.
 */
import { describe, expect, it } from "vitest";
import type { Impl, Instance, Json, KeyedHandle, Park, Resources } from "../src/kernel/index.js";
import {
  boot,
  BootError,
  defineIface,
  ifaceData,
  initialDoc,
  keyed,
  s,
  upgrade,
} from "../src/kernel/index.js";

/** Minimal in-memory Resources for tests. */
function makeResources(): Resources {
  const map = new Map<string, unknown>();
  return {
    register: (id, resource) => void map.set(id, resource),
    claim: <T>(id: string) => map.get(id) as T | undefined,
    release: (id) => void map.delete(id),
  };
}

// -- A tiny tree: root { counters: keyed(counter) } ------------------------

interface CounterApi extends Park {
  incr(): number;
  value(): number;
}

const CounterIface = defineIface<CounterApi, { count: number }>({
  name: "counter",
  version: 1,
  context: s.object<{ count: number }>({ count: s.number() }),
  methods: ["park", "incr", "value"],
});

const counterImpl: Impl<CounterApi, { count: number }> = {
  create(_ctx, context) {
    let count = context.count;
    return {
      park: () => ({ count }),
      incr: () => ++count,
      value: () => count,
    };
  },
};

interface RootApi extends Park {
  label(): string;
  counters(): KeyedHandle<CounterApi>;
}

function makeRootIface(version: number, migrations: Record<number, (old: Json) => Json> = {}) {
  return defineIface<RootApi, { label: string }>({
    name: "root",
    version,
    context: s.object<{ label: string }>({ label: s.string() }),
    methods: ["park", "label", "counters"],
    children: { counters: keyed(CounterIface) },
    migrations,
  });
}

const rootIface = makeRootIface(1);

function makeRootImpl(tag: string): Impl<RootApi, { label: string }> {
  return {
    children: { counters: counterImpl },
    create(_ctx, context, children) {
      const counters = children.counters as KeyedHandle<CounterApi>;
      return {
        park: () => ({ label: context.label }),
        label: () => `${tag}:${context.label}`,
        counters: () => counters,
      };
    },
  };
}

async function bootRoot(tag = "v1"): Promise<{ inst: Instance<RootApi>; resources: Resources }> {
  const resources = makeResources();
  const inst = await boot(
    makeRootImpl(tag),
    rootIface,
    initialDoc(rootIface, { label: "hello" }),
    resources,
  );
  return { inst, resources };
}

describe("kernel: boot", () => {
  it("boots a tree, parks it in the tree's shape, and round-trips through boot", async () => {
    const { inst, resources } = await bootRoot();
    await inst.api.counters().add("a", { count: 3 });
    inst.api.counters().get("a")!.incr();

    const doc = inst.park();
    expect(doc.v).toBe(1);
    expect(doc.self).toEqual({ label: "hello" });
    expect(doc.children).toEqual({
      counters: { items: { a: { v: 1, self: { count: 4 }, children: {} } } },
    });

    const again = await boot(makeRootImpl("v1"), rootIface, doc, resources);
    expect(again.api.counters().get("a")!.value()).toBe(4);
  });

  it("rejects an impl that does not satisfy the iface method set", async () => {
    const bad = {
      children: { counters: counterImpl },
      create: () => ({ park: () => null }),
    } as unknown as Impl<RootApi, { label: string }>;
    await expect(
      boot(bad, rootIface, initialDoc(rootIface, { label: "x" }), makeResources()),
    ).rejects.toThrow(/missing method\(s\) \[label, counters\]/);
  });

  it("rejects a context document that fails strict parse", async () => {
    await expect(
      boot(makeRootImpl("v1"), rootIface, initialDoc(rootIface, { label: 42 }), makeResources()),
    ).rejects.toThrow(BootError);
  });

  it("drains effects children-first on dispose", async () => {
    const order: string[] = [];
    interface LeafApi extends Park {
      poke(): void;
    }
    const leafIface = defineIface<LeafApi, null>({
      name: "leaf",
      version: 1,
      context: s.json() as never,
      methods: ["park", "poke"],
    });
    const leafImpl: Impl<LeafApi, Json> = {
      create(ctx) {
        ctx.effect(() => order.push("leaf"));
        return { park: () => null, poke: () => undefined };
      },
    };
    const parentIface = defineIface<Park, Json>({
      name: "parent",
      version: 1,
      context: s.json(),
      methods: ["park"],
      children: { leaf: leafIface },
    });
    const parentImpl: Impl<Park, Json> = {
      children: { leaf: leafImpl },
      create(ctx) {
        ctx.effect(() => order.push("parent-first"));
        ctx.effect(() => order.push("parent-second"));
        return { park: () => null };
      },
    };
    const inst = await boot(
      parentImpl,
      parentIface,
      initialDoc(parentIface, null, { leaf: initialDoc(leafIface, null) }),
      makeResources(),
    );
    inst.dispose();
    // Children first, then own effects in reverse registration order.
    expect(order).toEqual(["leaf", "parent-second", "parent-first"]);
  });

  it("serializes the iface descriptor as data", () => {
    const data = ifaceData(rootIface) as {
      name: string;
      children: { counters: { keyed: { name: string } } };
    };
    expect(data.name).toBe("root");
    expect(data.children.counters.keyed.name).toBe("counter");
  });
});

describe("kernel: upgrade ladder", () => {
  it("silent upgrade: same schema, new impl, state preserved", async () => {
    const { inst, resources } = await bootRoot("v1");
    await inst.api.counters().add("a", { count: 10 });

    const result = await upgrade({
      current: inst,
      impl: makeRootImpl("v2"),
      iface: rootIface,
      resources,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).toBe("silent");
    expect(result.instance.api.label()).toBe("v2:hello");
    expect(result.instance.api.counters().get("a")!.value()).toBe(10);
  });

  it("migrated upgrade: chained migrations run and mode is 'migrated'", async () => {
    const { inst, resources } = await bootRoot("v1");
    // v3 renames label→title via 1→2, then annotates via 2→3.
    interface RootV3Api extends Park {
      title(): string;
    }
    const v3Iface = defineIface<RootV3Api, { title: string }>({
      name: "root",
      version: 3,
      context: s.object<{ title: string }>({ title: s.string() }),
      methods: ["park", "title"],
      children: { counters: keyed(CounterIface) },
      migrations: {
        1: (old) => ({ title: (old as { label: string }).label }),
        2: (old) => ({ title: `${(old as { title: string }).title}!` }),
      },
    });
    const v3Impl: Impl<RootV3Api, { title: string }> = {
      children: { counters: counterImpl },
      create(_ctx, context) {
        return { park: () => ({ title: context.title }), title: () => context.title };
      },
    };
    const result = await upgrade({ current: inst, impl: v3Impl, iface: v3Iface, resources });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.mode).toBe("migrated");
    expect(result.instance.api.title()).toBe("hello!");
  });

  it("blocked upgrade: dropped fields are intercepted, old instance keeps running", async () => {
    const { inst, resources } = await bootRoot("v1");
    // New schema no longer knows `label` and provides no migration: label would be dropped.
    const narrowIface = defineIface<Park, Record<string, never>>({
      name: "root",
      version: 1,
      context: s.object<Record<string, never>>({}),
      methods: ["park"],
      children: { counters: keyed(CounterIface) },
    });
    const narrowImpl: Impl<Park, Json> = {
      children: { counters: counterImpl },
      create: () => ({ park: () => ({}) }),
    };
    const result = await upgrade({
      current: inst,
      impl: narrowImpl,
      iface: narrowIface,
      resources,
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.dropped).toEqual(["$.self.label"]);
    // The old instance was never touched.
    expect(inst.api.label()).toBe("v1:hello");
    // The parked doc is returned for persistence: nothing is lost.
    expect((result.doc as { self: { label: string } }).self.label).toBe("hello");
  });

  it("blocked upgrade: version gap without a migration path", async () => {
    const { inst, resources } = await bootRoot("v1");
    const v2NoMigration = makeRootIface(2);
    const result = await upgrade({
      current: inst,
      impl: makeRootImpl("v2"),
      iface: v2NoMigration,
      resources,
    });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.missing).toContain("$.v: no migration path from v1 to v2");
  });

  it("live resources survive an upgrade via claim-by-id", async () => {
    // The pty pattern: the resource lives in the runtime registry, the context
    // only carries its id, boot claims it back.
    interface HolderApi extends Park {
      read(): string;
    }
    const holderIface = defineIface<HolderApi, { resourceId: string }>({
      name: "holder",
      version: 1,
      context: s.object<{ resourceId: string }>({ resourceId: s.string() }),
      methods: ["park", "read"],
    });
    const holderImpl: Impl<HolderApi, { resourceId: string }> = {
      create(ctx, context) {
        const res = ctx.resources.claim<{ data: string }>(context.resourceId);
        if (res === undefined) throw new BootError(`claim failed: ${context.resourceId}`);
        return { park: () => ({ resourceId: context.resourceId }), read: () => res.data };
      },
    };
    const resources = makeResources();
    resources.register("res_1", { data: "alive" });
    const inst = await boot(
      holderImpl,
      holderIface,
      initialDoc(holderIface, { resourceId: "res_1" }),
      resources,
    );
    const result = await upgrade({
      current: inst,
      impl: holderImpl,
      iface: holderIface,
      resources,
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.instance.api.read()).toBe("alive");
  });
});

describe("kernel: undeclared children in the parked doc", () => {
  // The narrower iface knows nothing about `counters`.
  const bareIface = defineIface<RootApi, { label: string }>({
    name: "root",
    version: 1,
    context: s.object<{ label: string }>({ label: s.string() }),
    methods: ["park", "label", "counters"],
  });
  const bareImpl: Impl<RootApi, { label: string }> = {
    create(_ctx, context) {
      return {
        park: () => ({ label: context.label }),
        label: () => context.label,
        counters: () => {
          throw new Error("no counters in bare root");
        },
      };
    },
  };

  it("an EMPTY undeclared keyed collection is not data: silently dropped", async () => {
    const { inst, resources } = await bootRoot();
    const result = await upgrade({ current: inst, impl: bareImpl, iface: bareIface, resources });
    expect(result.status).toBe("ok");
  });

  it("a NON-EMPTY undeclared keyed collection is data: blocked", async () => {
    const { inst, resources } = await bootRoot();
    await inst.api.counters().add("a", { count: 1 });
    const result = await upgrade({ current: inst, impl: bareImpl, iface: bareIface, resources });
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.dropped).toEqual(["$.children.counters"]);
  });
});
