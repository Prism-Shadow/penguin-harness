/**
 * The kernel's one decision: may an incoming generation swap in over the running one?
 *
 * The module exists to make that call, and its refusal is the only failure that costs a
 * running instance — so this file measures the decision itself, not the shape of a parked
 * document. Two primitives make it: `checkTree` (manifests + the interface table in,
 * problems out; nothing executes) and the `upgrade` ladder (`defineIface` / `Park` / `boot`)
 * a hot push is built on.
 *
 * Negative: an incoming interface table the running kernel must refuse — a provided
 * interface gone, one changed at signature level, parked state a changed context would
 * discard — is refused, and the running instance keeps serving untouched: never disposed,
 * still answering, its parked document unchanged.
 * Positive: a compatible table swaps in — through the migration chain it ships — and the NEW
 * tree answers, read from its api at the kernel level rather than inferred from a shape.
 */
import { describe, expect, it } from "vitest";
import type {
  IfaceDecl,
  IfaceTable,
  Impl,
  JsonObject,
  Manifest,
  ManifestNode,
  ModuleDef,
  Park,
  Resources,
} from "../src/kernel/index.js";
import {
  boot,
  bootModules,
  checkTree,
  defineIface,
  defineModule,
  ifaceData,
  initialDoc,
  ModuleBootError,
  parseManifest,
  satisfies,
  schema,
  type,
  upgrade,
} from "../src/kernel/index.js";

const resources: Resources = { register: () => () => {}, claim: () => undefined };

const str = { data: "string" } as const;

const manifest = (m: Partial<Manifest> & { name: string }): Manifest =>
  parseManifest({ requires: {}, provides: {}, contributes: {}, children: [], ...m });

// ─────────────────── the interface table: checkTree + bootModules ───────────────────

/** The running generation's contract: one method. */
const Library: IfaceDecl = {
  name: "Library",
  methods: { titles: { params: [], returns: { data: "string[]" } } },
  slots: {},
};

/** What a compatible successor offers: the same method, one added — still satisfies `Library`. */
const LibraryPlus: IfaceDecl = {
  ...Library,
  methods: {
    ...Library.methods,
    add: { params: [str], returns: { void: true } },
  },
};

/** What an incompatible one offers: `titles` changed at signature level. */
const LibraryChanged: IfaceDecl = {
  ...Library,
  methods: { titles: { params: [], returns: { data: "number[]" } } },
};

const platform = manifest({ name: "platform", children: ["reading", "shelf"] });
const reading = manifest({
  name: "reading",
  provides: { library: "Library" },
  context: { version: 1, schema: { titles: "string[]" } },
});
const shelf = manifest({
  name: "shelf",
  requires: { library: { iface: "Library", from: "reading" } },
});

/** The same tree as manifests, for the check that runs without executing any code. */
const manifestTree: ManifestNode = {
  manifest: platform,
  children: [
    { manifest: reading, children: [] },
    { manifest: shelf, children: [] },
  ],
};

/**
 * The running tree: `reading` provides the library and parks what it holds, `shelf` requires
 * it from there. Both creates are counted, so a refusal that ran any code is visible.
 */
function runningTree(count: { reading: number; shelf: number }): ModuleDef {
  return defineModule(platform, {
    create: () => ({ api: {} }),
    children: [
      defineModule(reading, {
        create: (_ctx, context) => {
          count.reading += 1;
          const carried = (context as { titles: string[] } | null)?.titles ?? ["Existing"];
          return {
            api: { library: { titles: () => [...carried] } },
            park: () => ({ titles: carried }),
          };
        },
      }),
      defineModule(shelf, {
        create: (ctx) => {
          count.shelf += 1;
          // The wire is live: the requirement resolves to the running implementation.
          return { api: { seen: (ctx.use.library as { titles(): string[] }).titles().length } };
        },
      }),
    ],
  });
}

/**
 * The incoming generation's code. `carried` is what it expects its own module document to
 * hold (what the predecessor parked, when the swap hands it over), `added` what the new
 * implementation contributes — never run on a refusal.
 */
function incomingTree(
  carried: string[],
  added: string[],
  count: { reading: number; shelf: number },
): ModuleDef {
  const answer = [...carried, ...added];
  return defineModule(platform, {
    create: () => ({ api: {} }),
    children: [
      defineModule(reading, {
        create: (_ctx, context) => {
          count.reading += 1;
          expect(
            (context as { titles: string[] } | null)?.titles ?? carried,
            "the predecessor's parked state came across",
          ).toEqual(carried);
          return {
            api: { library: { titles: () => answer, add: () => {} } },
            park: () => ({ titles: carried }),
          };
        },
      }),
      defineModule(shelf, {
        create: (ctx) => {
          count.shelf += 1;
          expect((ctx.use.library as { titles(): string[] }).titles()).toEqual(answer);
          return { api: {} };
        },
      }),
    ],
  });
}

describe("an incoming interface table decides whether the tree may swap in", () => {
  it("refuses a gone or signature-changed interface and leaves the running tree serving", async () => {
    const count = { reading: 0, shelf: 0 };
    const running = await bootModules(runningTree(count), {
      ifaces: { "reading#Library": Library, "shelf#Library": Library },
      resources,
    });
    const answers = running.api<{ titles(): string[] }>("reading", "library");
    expect(answers.titles(), "the running tree answers before the push").toEqual(["Existing"]);

    // The incoming table no longer carries the interface the running tree published.
    const gone = checkTree(manifestTree, { "shelf#Library": Library });
    expect(gone.problems).toEqual([
      expect.objectContaining({ path: "/platform/reading", kind: "unknown-iface", ref: "Library" }),
      expect.objectContaining({ path: "/platform/shelf", kind: "unresolved", alias: "library" }),
    ]);

    // It carries the interface, changed at signature level: the consumer's contract breaks.
    const changedTable: IfaceTable = {
      ifaces: { "reading#Library": LibraryChanged, "shelf#Library": Library },
      types: {},
    };
    const changed = checkTree(manifestTree, changedTable);
    expect(changed.problems).toEqual([
      expect.objectContaining({
        path: "/platform/shelf",
        kind: "mismatch",
        alias: "library",
        from: "reading",
        method: "titles",
      }),
    ]);

    // Both refusals land before any code runs: the incoming generation never creates.
    const incoming = incomingTree(["Existing"], ["Added"], count);
    await expect(
      bootModules(incoming, { ifaces: { "shelf#Library": Library }, resources }),
    ).rejects.toThrow(ModuleBootError);
    await expect(bootModules(incoming, { ifaces: changedTable, resources })).rejects.toThrow(
      ModuleBootError,
    );
    expect(count, "only the running generation ever created").toEqual({ reading: 1, shelf: 1 });

    // Meanwhile the running instance keeps serving, untouched.
    expect(answers.titles()).toEqual(["Existing"]);
    expect(running.has("reading")).toBe(true);
    running.dispose();
  });

  it("swaps a compatible table in and the new tree answers", async () => {
    const count = { reading: 0, shelf: 0 };
    const first = await bootModules(runningTree(count), {
      ifaces: { "reading#Library": Library, "shelf#Library": Library },
      resources,
    });
    expect(first.api<{ titles(): string[] }>("reading", "library").titles()).toEqual(["Existing"]);

    // The incoming table is compatible: the consumer's requirement is still covered.
    const table: IfaceTable = {
      ifaces: { "reading#Library": LibraryPlus, "shelf#Library": Library },
      types: {},
    };
    expect(satisfies(LibraryPlus, Library), "the successor still satisfies the contract").toEqual(
      [],
    );
    expect(checkTree(manifestTree, table).problems).toEqual([]);

    // The swap: the running tree's parked state goes in, the successor comes up and answers.
    const second = await bootModules(incomingTree(["Existing"], ["Added"], count), {
      ifaces: table,
      resources,
      parked: first.park(),
    });
    expect(
      second.api<{ titles(): string[]; add(t: string): void }>("reading", "library").titles(),
    ).toEqual(["Existing", "Added"]);
    first.dispose();
    second.dispose();
  });
});

// ─────────────────── the same decision on the upgrade ladder: Park + defineIface ───────────────────

interface RootApi extends Park {
  rows(): string[];
}

type RowsCtx = { rows: string[] };

/** The running generation's interface, as data: version 1, one method, `{ rows }` of state. */
const RootV1 = defineIface<RootApi, RowsCtx>({
  name: "Root",
  version: 1,
  context: schema<RowsCtx>(type({ rows: "string[]" }) as never),
  methods: ["rows"],
});

/** A compatible successor: version 2, the same state plus a field the migrator writes. */
type LabeledCtx = { rows: string[]; label: string };

const RootV2 = defineIface<RootApi, LabeledCtx>({
  name: "Root",
  version: 2,
  context: schema<LabeledCtx>(type({ rows: "string[]", label: "string" }) as never),
  methods: ["rows"],
  migrations: {
    1: (old) => {
      const prev = old as JsonObject;
      return { ...prev, label: "carried" };
    },
  },
});

/** An incompatible successor of the same version: the state the running one parked is gone. */
const RootChanged = defineIface<RootApi, { labels: string[] }>({
  name: "Root",
  version: 1,
  context: schema<{ labels: string[] }>(type({ labels: "string[]" }) as never),
  methods: ["rows"],
});

describe("the upgrade ladder refuses and swaps, and the tree answers either way", () => {
  it("refuses a swap that would discard parked state, and the running instance keeps serving", async () => {
    let disposed = 0;
    const running = await boot(
      {
        create(ctx, context) {
          const rows = [...context.rows];
          ctx.effect(() => {
            disposed += 1;
          });
          return { rows: () => rows, park: () => ({ rows }) };
        },
      },
      RootV1,
      initialDoc(RootV1, { rows: ["Existing"] }),
      resources,
    );
    expect(running.api.rows(), "the running instance answers before the push").toEqual([
      "Existing",
    ]);

    // The incoming interface table is a different declaration: its context would drop `rows`.
    expect(ifaceData(RootChanged)).not.toEqual(ifaceData(RootV1));

    let boots = 0;
    const successor: Impl<RootApi, { labels: string[] }> = {
      create: () => {
        boots += 1;
        return { rows: () => [], park: () => ({}) };
      },
    };
    const result = await upgrade({
      current: running,
      impl: successor,
      iface: RootChanged,
      resources,
    });

    if (result.status !== "blocked") throw new Error(`expected a refusal, got ${result.status}`);
    expect(result.dropped).toEqual(["$.self.rows"]);
    expect(result.missing).toEqual(["$.self.labels"]);
    expect(boots, "the successor never booted").toBe(0);
    expect(disposed, "the running tree was never disposed").toBe(0);

    // Still serving, from the same state.
    expect(running.api.rows()).toEqual(["Existing"]);
    expect(running.park()).toEqual({ v: 1, self: { rows: ["Existing"] }, children: {} });
    running.dispose();
    expect(disposed).toBe(1);
  });

  it("swaps a compatible successor through its migration chain and the new instance answers", async () => {
    let disposed = 0;
    const running = await boot(
      {
        create(ctx, context) {
          const rows = [...context.rows];
          ctx.effect(() => {
            disposed += 1;
          });
          return { rows: () => rows, park: () => ({ rows }) };
        },
      },
      RootV1,
      initialDoc(RootV1, { rows: ["Existing"] }),
      resources,
    );

    const successor: Impl<RootApi, LabeledCtx> = {
      create: (_ctx, context) => ({
        rows: () => [context.label, ...context.rows],
        park: () => ({ rows: context.rows }),
      }),
    };
    const result = await upgrade({ current: running, impl: successor, iface: RootV2, resources });

    if (result.status !== "ok")
      throw new Error(`expected a swap, got ${result.status}: ${JSON.stringify(result)}`);
    expect(result.mode, "the migrator chain ran").toBe("migrated");
    expect(disposed, "the predecessor was disposed by the swap").toBe(1);
    expect(result.doc).toEqual({
      v: 2,
      self: { rows: ["Existing"], label: "carried" },
      children: {},
    });
    // The NEW tree answers, at the kernel level.
    expect(result.instance.api.rows()).toEqual(["carried", "Existing"]);
    result.instance.dispose();
  });
});
