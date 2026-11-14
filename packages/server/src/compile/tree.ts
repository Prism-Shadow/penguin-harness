/**
 * The module tree as the compile pipeline sees it: manifests are the program, create()
 * functions are opaque leaves, and every question the pipeline asks — which interfaces
 * a def provides, which modules exist, what the checker will see — is answered from
 * that data alone, never by executing anything.
 *
 * The kernel owns the shapes (ModuleDef, Manifest, IfaceDecl); nothing here touches
 * them — the pipeline is a consumer of the tree, not an extension of the kernel.
 */
import type {
  IfaceClass,
  IfaceDecl,
  ManifestNode,
  ModuleDef,
  TableLike,
} from "@prismshadow/penguin-core/kernel";
import { ifaceKey, tableOf } from "@prismshadow/penguin-core/kernel";

/** Depth-first over the tree, each parent before its children. */
export function* walkDefs(def: ModuleDef): IterableIterator<ModuleDef> {
  yield def;
  for (const child of def.children ?? []) yield* walkDefs(child);
}

/**
 * An interface class's declared name — the word the generator read off the source into
 * the table (`symbol.getName()`), which for the code as it ships is the class's own
 * `.name`. That is the one soft edge in requiring by class instead of by string: a
 * minifier that renames the binding changes `.name` with it, and two same-named
 * classes collide. The kernel's own node names dodge this with the decorator context's
 * `name` (a string literal the minifier cannot touch); the thorough fix on this edge is
 * the generator's — stamp the table key onto the class it projects, and read it here.
 * Until then the name is the bridge between a pass's `requires` (classes) and the
 * tree's provisions (declared names, from the table).
 */
export function declNameOf(cls: IfaceClass): string {
  return cls.name;
}

const snapshots = new WeakSet<ModuleDef>();

/** Snapshot nested data once; immutable descendants are shared across later edits. */
export function copyTree(def: ModuleDef): ModuleDef {
  const visiting = new Set<ModuleDef>();
  const dataPath = new Set<object>();
  const freeze = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (dataPath.has(value)) throw new Error("module manifest contains cyclic data");
    if (Object.isFrozen(value)) return;
    dataPath.add(value);
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
    dataPath.delete(value);
  };
  const copy = (d: ModuleDef): ModuleDef => {
    if (snapshots.has(d)) return d;
    if (visiting.has(d)) throw new Error("module containment cycle");
    if (
      d === null ||
      typeof d !== "object" ||
      d.manifest === null ||
      typeof d.manifest !== "object"
    ) {
      throw new Error("rewrite returned no module definition");
    }
    visiting.add(d);
    const manifest = structuredClone(d.manifest);
    freeze(manifest);
    const children = d.children?.map(copy);
    if (children !== undefined) Object.freeze(children);
    const result: ModuleDef = Object.freeze({
      ...d,
      manifest,
      ...(d.migrations === undefined ? {} : { migrations: Object.freeze({ ...d.migrations }) }),
      ...(children === undefined ? {} : { children }),
    });
    snapshots.add(result);
    visiting.delete(d);
    return result;
  };
  return copy(def);
}

/** The tree as the kernel's checker takes it: manifests only, no code halves. */
export function manifestTreeOf(def: ModuleDef): ManifestNode {
  return {
    manifest: def.manifest,
    children: (def.children ?? []).map(manifestTreeOf),
  };
}

/**
 * Every interface name the tree provides, resolved through the table — the pipeline's
 * answer to a pass's requires: "is what I require somewhere in the tree I was handed?"
 * Names, not modules: who provides it is the kernel's wiring decision to make, not the
 * pass's to need.
 */
export function providedIfaceNames(def: ModuleDef, table: TableLike): Set<string> {
  const out = new Set<string>();
  const ifaces = tableOf(table).ifaces;
  for (const d of walkDefs(def)) {
    for (const ref of Object.values(d.manifest.provides)) {
      const decl: IfaceDecl | undefined = ifaces[ifaceKey(d.manifest.name, ref)];
      if (decl !== undefined) out.add(decl.name);
    }
  }
  return out;
}

/**
 * Every entry a tree's manifests carry for one slot, in tree order — the pipeline's
 * registry. A slot's registrations are manifest DATA wherever they sit: a module that
 * ships a pass registers it in its own `contributes`, and the tree the host assembled
 * says what runs. The pipeline rejects duplicate pass ids before resolving factories,
 * so one tree cannot run the same pass twice.
 */
export function contributionsOf<D extends { id: string }>(def: ModuleDef, slotKey: string): D[] {
  const out: D[] = [];
  for (const d of walkDefs(def)) {
    const entries = d.manifest.contributes[slotKey] as unknown as readonly D[] | undefined;
    if (entries !== undefined) out.push(...entries);
  }
  return out;
}

/** debug(): the compiled tree as one readable block — every module, its provided aliases. */
export function describeTree(def: ModuleDef): string {
  const lines: string[] = [];
  const walk = (d: ModuleDef, path: string): void => {
    const provides = Object.keys(d.manifest.provides);
    lines.push(`${path}${provides.length > 0 ? ` => ${provides.join(", ")}` : ""}`);
    for (const child of d.children ?? []) walk(child, `${path}/${child.manifest.name}`);
  };
  walk(def, def.manifest.name);
  return lines.join("\n");
}
