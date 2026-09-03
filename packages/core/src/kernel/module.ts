/**
 * Module tree boot: manifests decide the wiring, code only provides implementations.
 *
 * A module is a manifest ({@link Manifest}) plus one `create`. Boot runs {@link checkTree}
 * over the manifests first — nothing is created while a problem stands — then creates
 * modules in dependency order: a module boots after everything it `requires` and after
 * every module that CONTRIBUTES to one of its slots (the code half of a contribution is
 * the contributor's `bind[id]`, which exists only once the contributor is created).
 *
 * The tree shape is scope, not order: siblings are created in whatever order their
 * edges allow, and a cycle is a boot error naming the modules in it.
 *
 * Parked state: each module's `park()` result is stored under its name; `bootModules`
 * takes that map back and hands each module its own document after running the
 * module's migrations. This is the platform node's `modules` field.
 */
import { type } from "arktype";
import type { Json, JsonObject } from "./json.js";
import { isJsonObject } from "./json.js";
import type { Resources } from "./boot.js";
import type { IfaceDecl, TableLike } from "./sig.js";
import { satisfies, tableOf } from "./sig.js";
import type { ContextDecl, Manifest, Requirement } from "./manifest.js";
import { splitSlotKey } from "./manifest.js";
import type { ManifestNode, Problem, Published } from "./check.js";
import { checkTree, describeProblem } from "./check.js";

/** One contribution as the consuming module receives it. */
export interface Contributed<D = JsonObject, C = unknown> {
  id: string;
  /** The contributor module's name. */
  from: string;
  data: D;
  /** The contributor's `bind[id]`, when the slot declares a code half. */
  code?: C;
}

export interface ModuleCtx<Use = Record<string, unknown>> {
  /** Resolved requirements, by the manifest's alias. */
  use: Use;
  /** Contributions to this module's slots, by slot name. */
  contributions: Record<string, Contributed[]>;
  resources: Resources;
  /** Self-cleaning registration; drained at dispose in reverse order, children first. */
  effect(dispose: () => void): void;
}

export interface ModuleInstance<Api = Record<string, unknown>> {
  /** Provided implementations, by the manifest's provides alias. */
  api: Api;
  /** Implementations of this module's own contributions, by contribution id. */
  bind?: Record<string, unknown>;
  park?(): Json;
}

export interface ModuleDef<
  M extends Manifest = Manifest,
  Use = Record<string, unknown>,
  Api = Record<string, unknown>,
> {
  manifest: M;
  /** Context migrations by from-version, chained (1→2→3). */
  migrations?: Record<number, (old: Json) => Json>;
  create(ctx: ModuleCtx<Use>, context: Json): ModuleInstance<Api> | Promise<ModuleInstance<Api>>;
  children?: ModuleDef[];
}

type RefKey<Ref, Mod extends string> = Ref extends `${string}#${string}`
  ? Ref
  : Ref extends string
    ? `${Mod}#${Ref}`
    : never;
type Lookup<Reg, K> = K extends keyof Reg ? Reg[K] : unknown;

/**
 * Interface key (`<module>#<Export>`) → TypeScript type: a registry a package
 * may declare over its interface classes, and `moduleDefiner<ThatRegistry>()` is how a manifest literal
 * gets to type its own `use` and `api`.
 */
export type IfaceRegistry = object;

/** The `use` a manifest's `requires` resolves to, by alias. */
export type UseOf<M extends Manifest, Reg extends IfaceRegistry = IfaceRegistry> = {
  [A in keyof M["requires"]]: Lookup<Reg, RefKey<M["requires"][A]["iface"], M["name"]>>;
};
/** The `api` a manifest's `provides` demands, by alias. */
export type ApiOf<M extends Manifest, Reg extends IfaceRegistry = IfaceRegistry> = {
  [A in keyof M["provides"]]: Lookup<Reg, RefKey<M["provides"][A], M["name"]>>;
};

export interface ModuleImplOf<M extends Manifest, Reg extends IfaceRegistry> {
  migrations?: Record<number, (old: Json) => Json>;
  create(
    ctx: ModuleCtx<UseOf<M, Reg>>,
    context: Json,
  ): ModuleInstance<ApiOf<M, Reg>> | Promise<ModuleInstance<ApiOf<M, Reg>>>;
  children?: ModuleDef[];
}

/**
 * A `defineModule` bound to an interface registry. A module is its manifest as a literal
 * (the static half — the generator extracts it without executing the file) and its
 * create; `use` and `api` are typed FROM the manifest through the registry, so the two
 * cannot drift: an alias renamed in `requires` is a type error at every `ctx.use.<alias>`,
 * and an interface named in `provides` is what `api` must satisfy. A key the registry
 * does not carry types as `unknown` (a plugin requiring a host interface it has no
 * types for still boots; the host checks the signature).
 */
export function moduleDefiner<Reg extends IfaceRegistry>() {
  return function defineModule<const M extends Manifest>(
    manifest: M,
    impl: ModuleImplOf<M, Reg>,
  ): ModuleDef<M, UseOf<M, Reg>, ApiOf<M, Reg>> {
    return { manifest, ...impl };
  };
}

/** `defineModule` with no registry: every requirement is `unknown` at compile time. */
export const defineModule = moduleDefiner<IfaceRegistry>();

// ───────────────────────── class form: @Module / @Use / @Provide / @Bind ─────────────────────────

/** An interface handle: an abstract class whose instance type is the interface (see markers.ts Interface). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IfaceClass<T = any> = abstract new (...args: never[]) => T;
/** A module class: decorated with @Module; instantiated once per App; `create` is the module's create. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ModuleClass = abstract new (...args: any[]) => object;

/** What a module class's `create` receives: everything in {@link ModuleCtx} except `use` — requirements are fields. */
export type ClassCtx = Omit<ModuleCtx, "use">;

/**
 * The static half a module class declares in its decorator. Requirements and provisions
 * are FIELDS (`@Use`, `@Provide`), where their types already are; what is left here is
 * the name, the contributions (pure data), the parked context and the child classes.
 */
export interface ModuleMeta {
  readonly contributes?: Readonly<
    Record<string, ReadonlyArray<{ readonly id: string } & JsonObject>>
  >;
  readonly context?: ContextDecl;
  readonly children?: ReadonlyArray<ModuleClass>;
}

/** What a @Component declares: a module's meta minus children — a component exports itself. */
export type ComponentMeta = Omit<ModuleMeta, "children">;
type Meta = ModuleMeta & { readonly name: string; readonly kind: "module" | "component" };

interface ClassFields {
  /** field → the module class wired to provide it (undefined = any visible provider). */
  use: Map<string, ModuleClass | undefined>;
  provide: Set<string>;
  /** field → contribution id. */
  bind: Map<string, string>;
}

const metas = new WeakMap<ModuleClass, Meta>();
const fields = new WeakMap<ModuleClass, ClassFields>();
const fieldsOf = (cls: ModuleClass): ClassFields => {
  let f = fields.get(cls);
  if (f === undefined) {
    f = { use: new Map(), provide: new Set(), bind: new Map() };
    fields.set(cls, f);
  }
  return f;
};

/**
 * Registers a class as a module. `create(ctx, context)` runs once per App; the class's
 * `@Use` fields are injected before it, its `@Provide` fields are read after it, its
 * `@Bind` fields are the code halves of its contributions, and `park()` (optional)
 * parks its state.
 */
export function Module(meta: ModuleMeta = {}) {
  return (target: ModuleClass, _context: ClassDecoratorContext): void => {
    metas.set(target, { ...meta, name: target.name, kind: "module" });
  };
}

/**
 * Registers a class as a COMPONENT: a module that exports itself. The instance is the
 * provision, named in a consumer by its own class (`@Use() auth!: AuthService`), and its
 * interface is its public surface as the generator projects it. `@Use` fields are injected
 * before the optional `create(ctx, context)`; `@Bind` fields and `park()` work as on a
 * module. A class whose inputs no interface provides (a computed closure, a path) is built
 * by a @Module instead, which is what "exports others" means.
 */
export function Component(meta: ComponentMeta = {}) {
  return (target: ModuleClass, _context: ClassDecoratorContext): void => {
    metas.set(target, { ...meta, name: target.name, kind: "component" });
  };
}

/**
 * A requirement: `@Use(SessionsModule) readonly runner!: ScheduleTaskRunner;` — the field's
 * type is the interface, the decorator's argument the module wired to provide it (absent =
 * whichever visible module structurally satisfies it, if exactly one does). Injected before
 * `create`. The interface key comes from the generated table, which reads the annotation.
 */
export function Use(from?: ModuleClass) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).use.set(name, from);
    });
  };
}

/** A provision: `@Provide() settings!: Settings;` — assigned in `create`, read after it; unassigned = boot error. */
export function Provide() {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).provide.add(name);
    });
  };
}

/** The code half of one contribution: `@Bind("agents.routes") routes!: Hono;` — assigned in `create`. */
export function Bind(id: string) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const name = String(context.name);
    context.addInitializer(function (this: unknown) {
      fieldsOf((this as object).constructor as ModuleClass).bind.set(name, id);
    });
  };
}

/**
 * Constructs a component OUTSIDE a tree — a script or a test that wants the class with
 * its fields supplied by hand. The fields are assigned as the booter would inject them;
 * nothing is checked, and `create()` is not called.
 */
export function wire<T extends object>(
  cls: new () => T,
  // `any`, so a callback supplied here is contextually typed rather than an implicit any.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fields: Record<string, any>,
): T {
  return Object.assign(new cls(), fields);
}

/** The meta a class was decorated with; throws for an undecorated class. */
export function moduleMetaOf(cls: ModuleClass): Meta {
  const m = metas.get(cls);
  if (m === undefined)
    throw new ModuleBootError(`class '${cls.name}' is not a @Module or @Component`);
  return m;
}

/** The manifests the generator extracted, by module name — the `modules` section of the table. */
export type ManifestTable = Readonly<Record<string, Manifest>>;

/**
 * Turns a module class (and, recursively, its children) into the {@link ModuleDef} the
 * booter runs. The string manifest is the generator's (`table.modules[name]` — it read the
 * field annotations statically); the class is checked against it: every `@Use` field must
 * be a requirement there with the same `from`, every `@Provide` field a provision, every
 * child class a child. A mismatch means the table is stale, and says so. `instances`
 * supplies pre-built instances for classes whose constructor takes arguments.
 */
export function moduleDefOf(
  cls: ModuleClass,
  opts: {
    manifests: ManifestTable;
    instances?: ReadonlyMap<ModuleClass, object>;
    extra?: ModuleDef[];
  },
): ModuleDef {
  const meta = moduleMetaOf(cls);
  const manifest = opts.manifests[meta.name];
  if (manifest === undefined) {
    throw new ModuleBootError(`${meta.name}: not in the generated manifest table — run gen:ifaces`);
  }
  const instance = (opts.instances?.get(cls) ??
    new (cls as unknown as new () => object)()) as Record<string, unknown> & {
    setup?: (ctx: ClassCtx, context: Json) => void | Promise<void>;
    park?: () => Json;
    migrations?: Record<number, (old: Json) => Json>;
  };
  const f = fieldsOf(cls);
  const stale = (what: string) =>
    new ModuleBootError(
      `${meta.name}: ${what} — the generated manifest table is stale; run gen:ifaces`,
    );
  for (const [field, from] of f.use) {
    const r = manifest.requires[field];
    if (r === undefined) throw stale(`@Use field '${field}' is not a requirement in the table`);
    // `@Use()` with no argument leaves the wiring to the table (the generator wires a field
    // typed by a component class to that component); an explicit argument must agree.
    const fromName = from === undefined ? undefined : moduleMetaOf(from).name;
    if (fromName !== undefined && r.from !== fromName)
      throw stale(
        `@Use field '${field}' is wired to '${fromName}' in code, '${r.from}' in the table`,
      );
  }
  for (const field of Object.keys(manifest.requires)) {
    if (!f.use.has(field)) throw stale(`requirement '${field}' in the table has no @Use field`);
  }
  const selfAlias = meta.kind === "component" ? cls.name : null;
  if (selfAlias !== null && manifest.provides[selfAlias] === undefined)
    throw stale(`component '${cls.name}' does not provide itself in the table`);
  for (const field of f.provide) {
    if (manifest.provides[field] === undefined)
      throw stale(`@Provide field '${field}' is not a provision in the table`);
  }
  for (const field of Object.keys(manifest.provides)) {
    if (field === selfAlias) continue;
    if (!f.provide.has(field))
      throw stale(`provision '${field}' in the table has no @Provide field`);
  }
  const childNames = (meta.children ?? []).map((c) => moduleMetaOf(c).name);
  const declared = manifest.children
    .map((c) => (typeof c === "string" ? c : c.keyed))
    .filter((c) => c !== "*");
  if (childNames.join(",") !== declared.join(",")) {
    throw stale(
      `children are [${childNames.join(", ")}] in code, [${declared.join(", ")}] in the table`,
    );
  }
  const extra = opts.extra ?? [];
  const def: ModuleDef = {
    manifest: {
      ...manifest,
      children: [...manifest.children.filter((c) => c !== "*"), ...(extra.length > 0 ? ["*"] : [])],
    },
    async create(ctx, context) {
      for (const field of f.use.keys())
        instance[field] = (ctx.use as Record<string, unknown>)[field];
      if (typeof instance.setup === "function") await instance.setup(ctx, context);
      const api: Record<string, unknown> = {};
      if (selfAlias !== null) api[selfAlias] = instance;
      for (const field of f.provide) {
        if (instance[field] === undefined) {
          throw new ModuleBootError(
            `${meta.name}: setup() left @Provide field '${field}' unassigned`,
          );
        }
        api[field] = instance[field];
      }
      const bind: Record<string, unknown> = {};
      for (const [field, id] of f.bind) {
        if (instance[field] === undefined) {
          throw new ModuleBootError(
            `${meta.name}: create() left @Bind field '${field}' ('${id}') unassigned`,
          );
        }
        bind[id] = instance[field];
      }
      const out: ModuleInstance = { api, bind };
      if (typeof instance.park === "function") out.park = () => instance.park!();
      return out;
    },
    children: [
      ...(meta.children ?? []).map((child) => moduleDefOf(child, { ...opts, extra: undefined })),
      ...extra,
    ],
  };
  if (instance.migrations !== undefined) def.migrations = instance.migrations;
  return def;
}

export class ModuleBootError extends Error {
  constructor(
    message: string,
    readonly problems: Problem[] = [],
  ) {
    super(message);
    this.name = "ModuleBootError";
  }
}

/** A booted tree. */
export interface ModuleTree {
  /** A module's provided api by module name and alias. */
  api<T = unknown>(module: string, alias: string): T;
  has(module: string): boolean;
  /** Every module's parked document, by name — the platform node stores this. */
  park(): Record<string, Json>;
  /** Reverse creation order. */
  dispose(): void;
}

export interface BootModulesOptions {
  ifaces: TableLike;
  /** What the host publishes: interface declarations AND the live values behind them. */
  published?: { ifaces: Published; values: Record<string, Record<string, unknown>> };
  resources: Resources;
  /** Parked documents from the previous generation, by module name. */
  parked?: Record<string, Json>;
}

interface Flat {
  def: ModuleDef;
  parent: Flat | null;
  childrenDefs: ModuleDef[];
}

function flatten(root: ModuleDef): { nodes: Flat[]; tree: ManifestNode } {
  const nodes: Flat[] = [];
  const walk = (def: ModuleDef, parent: Flat | null): ManifestNode => {
    const flat: Flat = { def, parent, childrenDefs: def.children ?? [] };
    nodes.push(flat);
    return { manifest: def.manifest, children: flat.childrenDefs.map((c) => walk(c, flat)) };
  };
  const tree = walk(root, null);
  return { nodes, tree };
}

/** The module each `requires` alias wires to, after the check has proven it unique. */
function wiring(
  manifest: Manifest,
  provides: Record<string, Record<string, IfaceDecl>>,
  ifaces: TableLike,
): Record<string, { from: string; alias: string }> {
  const out: Record<string, { from: string; alias: string }> = {};
  for (const [alias, need] of Object.entries(manifest.requires)) {
    const required =
      tableOf(ifaces).ifaces[
        need.iface.includes("#") ? need.iface : `${manifest.name}#${need.iface}`
      ]!;
    const candidates = need.from !== undefined ? [need.from] : Object.keys(provides);
    for (const from of candidates) {
      if (from === manifest.name) continue;
      for (const [pAlias, decl] of Object.entries(provides[from] ?? {})) {
        // checkTree already established satisfaction; pick the first satisfying alias.
        if (satisfiesQuick(decl, required, ifaces)) {
          out[alias] = { from, alias: pAlias };
          break;
        }
      }
      if (out[alias] !== undefined) break;
    }
  }
  return out;
}

function satisfiesQuick(offered: IfaceDecl, required: IfaceDecl, table: TableLike): boolean {
  return satisfies(offered, required, table).length === 0;
}

function migrateContext(def: ModuleDef, doc: Json | undefined): Json {
  const decl = def.manifest.context;
  if (decl === undefined || doc === undefined) return null; // No context, or a fresh boot: nothing to migrate.
  let version = 1;
  let self: Json = null;
  if (isJsonObject(doc) && typeof doc.v === "number" && "self" in doc) {
    version = doc.v;
    self = doc.self;
  } else if (doc !== undefined) {
    self = doc;
  }
  if (version > decl.version) {
    throw new ModuleBootError(
      `${def.manifest.name}: parked under context v${version}, newer than this module's v${decl.version}`,
    );
  }
  while (version < decl.version) {
    const migrate = def.migrations?.[version];
    if (migrate === undefined) {
      throw new ModuleBootError(
        `${def.manifest.name}: no context migration from v${version} to v${decl.version}`,
      );
    }
    self = migrate(self);
    version += 1;
  }
  if (decl.schema !== undefined && self !== null) {
    const out = type.raw(decl.schema).onUndeclaredKey("reject")(self);
    if (out instanceof type.errors) {
      throw new ModuleBootError(
        `${def.manifest.name}: parked context does not fit: ${out.summary}`,
      );
    }
  }
  return self;
}

export async function bootModules(root: ModuleDef, opts: BootModulesOptions): Promise<ModuleTree> {
  const { nodes, tree } = flatten(root);
  // The manifest's `children` is the declared shape; the defs are what boots. They must
  // agree — except that a manifest listing "*" accepts modules supplied at runtime
  // beyond the ones it names (plugin modules under the platform root).
  for (const n of nodes) {
    const declared = n.def.manifest.children.map((c) => (typeof c === "string" ? c : c.keyed));
    const open = declared.includes("*");
    const named = declared.filter((c) => c !== "*").sort();
    const actual = n.childrenDefs.map((c) => c.manifest.name).sort();
    const missing = named.filter((c) => !actual.includes(c));
    const extra = actual.filter((c) => !named.includes(c));
    if (missing.length > 0 || (!open && extra.length > 0)) {
      throw new ModuleBootError(
        `${n.def.manifest.name}: manifest declares children [${declared.join(", ")}] but the code supplies [${actual.join(", ")}]`,
      );
    }
  }
  const publishedIfaces = opts.published?.ifaces ?? {};
  const { problems, provides } = checkTree(tree, opts.ifaces, publishedIfaces);
  if (problems.length > 0) {
    throw new ModuleBootError(
      `module tree rejected:\n${problems.map((p) => `  - ${describeProblem(p)}`).join("\n")}`,
      problems,
    );
  }
  const byName = new Map(nodes.map((n) => [n.def.manifest.name, n]));
  const wires = new Map<string, Record<string, { from: string; alias: string }>>();
  for (const n of nodes)
    wires.set(n.def.manifest.name, wiring(n.def.manifest, provides, opts.ifaces));

  // Edges: a module comes after what it requires, after what contributes to it, and
  // after its children (a parent reaches its children's apis).
  const after = new Map<string, Set<string>>();
  for (const n of nodes) after.set(n.def.manifest.name, new Set());
  for (const n of nodes) {
    const name = n.def.manifest.name;
    for (const w of Object.values(wires.get(name)!)) {
      if (byName.has(w.from)) after.get(name)!.add(w.from);
    }
    for (const slotKey of Object.keys(n.def.manifest.contributes)) {
      const target = splitSlotKey(slotKey)!.module;
      if (byName.has(target)) after.get(target)!.add(name);
    }
    for (const child of n.childrenDefs) after.get(name)!.add(child.manifest.name);
  }
  const order: Flat[] = [];
  const state = new Map<string, "visiting" | "done">();
  const visit = (name: string, stack: string[]) => {
    const s = state.get(name);
    if (s === "done") return;
    if (s === "visiting") {
      throw new ModuleBootError(`module dependency cycle: ${[...stack, name].join(" → ")}`);
    }
    state.set(name, "visiting");
    for (const dep of after.get(name)!) visit(dep, [...stack, name]);
    state.set(name, "done");
    order.push(byName.get(name)!);
  };
  for (const n of nodes) visit(n.def.manifest.name, []);

  const instances = new Map<string, { inst: ModuleInstance; disposers: Array<() => void> }>();
  const created: string[] = [];
  const apiOf = (module: string, alias: string): unknown => {
    const inst = instances.get(module);
    if (inst !== undefined) return inst.inst.api[alias];
    const value = opts.published?.values[module]?.[alias];
    if (value === undefined) throw new ModuleBootError(`no api '${alias}' on module '${module}'`);
    return value;
  };
  const disposeAll = () => {
    for (const name of [...created].reverse()) {
      const entry = instances.get(name)!;
      for (const dispose of entry.disposers.reverse()) dispose();
      entry.disposers.length = 0;
    }
    created.length = 0;
    instances.clear();
  };
  try {
    for (const n of order) {
      const mf = n.def.manifest;
      const use: Record<string, unknown> = {};
      for (const [alias, w] of Object.entries(wires.get(mf.name)!))
        use[alias] = apiOf(w.from, w.alias);
      const contributions: Record<string, Contributed[]> = {};
      for (const other of nodes) {
        for (const [slotKey, entries] of Object.entries(other.def.manifest.contributes)) {
          const split = splitSlotKey(slotKey)!;
          if (split.module !== mf.name) continue;
          const slotDecl = Object.values(provides[mf.name] ?? {})
            .map((d) => d.slots[split.slot])
            .find((s) => s !== undefined);
          const list = (contributions[split.slot] ??= []);
          const contributor = instances.get(other.def.manifest.name);
          for (const entry of entries) {
            const { id, ...data } = entry;
            const item: Contributed = { id, from: other.def.manifest.name, data };
            if (slotDecl?.code !== undefined) {
              const code = contributor?.inst.bind?.[id];
              if (code === undefined) {
                throw new ModuleBootError(
                  `${other.def.manifest.name}: contribution '${id}' to '${slotKey}' declared but not bound`,
                );
              }
              item.code = code;
            }
            list.push(item);
          }
        }
      }
      const disposers: Array<() => void> = [];
      const ctx: ModuleCtx = {
        use,
        contributions,
        resources: opts.resources,
        effect: (dispose) => disposers.push(dispose),
      };
      const context = migrateContext(n.def, opts.parked?.[mf.name]);
      const inst = await n.def.create(ctx, context);
      for (const alias of Object.keys(mf.provides)) {
        const value = inst.api[alias];
        if (value === null || (typeof value !== "object" && typeof value !== "function")) {
          throw new ModuleBootError(`${mf.name}: create() returned no api for provides.${alias}`);
        }
        const decl = provides[mf.name]![alias]!;
        const missing = Object.keys(decl.methods).filter(
          (m) => typeof (value as Record<string, unknown>)[m] !== "function",
        );
        const absent = Object.entries(decl.fields ?? {})
          .filter(([, expr]) => !("maybe" in expr))
          .filter(([f]) => (value as Record<string, unknown>)[f] === undefined)
          .map(([f]) => f);
        if (missing.length > 0 || absent.length > 0) {
          throw new ModuleBootError(
            `${mf.name}: api '${alias}' does not satisfy '${decl.name}': missing [${[...missing, ...absent].join(", ")}]`,
          );
        }
      }
      instances.set(mf.name, { inst, disposers });
      created.push(mf.name);
    }
  } catch (err) {
    try {
      disposeAll();
    } catch {
      // The original failure is what the caller needs.
    }
    throw err;
  }
  return {
    api: <T>(module: string, alias: string) => apiOf(module, alias) as T,
    has: (module) => instances.has(module),
    park() {
      const out: Record<string, Json> = {};
      for (const [name, entry] of instances) {
        const decl = byName.get(name)!.def.manifest.context;
        if (decl === undefined || entry.inst.park === undefined) continue;
        out[name] = { v: decl.version, self: entry.inst.park() };
      }
      return out;
    },
    dispose: disposeAll,
  };
}
