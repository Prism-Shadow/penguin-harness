/**
 * boot(): the only place instances are created. Walks the static tree declared
 * by the iface, boots children first (keyed collections get a handle with
 * add/remove — runtime cardinality changes still go through boot), then calls
 * the impl factory and verifies the returned api against the iface method set.
 *
 * State discipline (linear state):
 * - serializable state lives in the parked context document,
 * - live resources stay in the runtime-side `Resources` registry and the
 *   context only carries handle ids (claim on boot; a failed claim is an
 *   explicit discard, surfaced to the upgrade ladder),
 * - reseedable state is rebuilt after boot and never parked.
 */
import type { Json, JsonObject } from "./json.js";
import { isJsonObject } from "./json.js";
import type { AnyIface, ChildDecl, Iface, Park } from "./iface.js";
import { isKeyed } from "./iface.js";

/** Runtime-owned live resources (pty, child processes, connections). */
export interface Resources {
  /**
   * `dispose` is how a resource says what "shut down" means for it — the registry
   * itself knows nothing about kinds, so a platform can introduce a resource type the
   * runtime has never heard of and still have it cleaned up at process exit.
   */
  register(id: string, resource: unknown, dispose?: () => void): void;
  claim<T = unknown>(id: string): T | undefined;
  release(id: string): void;
  /**
   * Disposes and removes every entry whose id belongs to the group (`terminal` covers
   * `terminal:*`), in reverse registration order — later entries may depend on earlier
   * ones, same convention as effects.
   *
   * A hook for IMPLEMENTATIONS, not a kernel mechanism: the kernel never calls it, and
   * upgrade() has no opinion about resource compatibility. An impl's create() uses it to
   * hard-stop the groups it cannot adopt from its predecessor (penguin does this over a
   * declaration it leaves in the registry itself — see server hmr/platform.ts). Optional,
   * so a registry that does not offer it simply carries every group across unchecked.
   */
  disposeGroup?(group: string): void;
}

export interface NodeCtx {
  resources: Resources;
  /** Self-cleaning registration: collected disposers are drained at dispose. */
  effect(dispose: () => void): void;
}

/** Handle a parent receives for a `keyed()` child collection. */
export interface KeyedHandle<A extends Park = Park> {
  get(key: string): A | undefined;
  keys(): string[];
  add(key: string, context: Json): Promise<A>;
  remove(key: string): void;
}

/**
 * An impl provides the factory for its node plus impls for declared children.
 * `children` values handed to create(): singleton child → its api, keyed
 * child → a KeyedHandle. (Loosely typed until the arktype-era inference —
 * see TODO(schema) in json.ts.)
 */
export interface Impl<A extends Park = Park, C extends Json = Json> {
  create(ctx: NodeCtx, context: C, children: Record<string, unknown>): A | Promise<A>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: Record<string, Impl<any, any>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyImpl = Impl<any, any>;

export class BootError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BootError";
  }
}

/** Parked tree node: `v` is the iface version the document was parked under. */
export interface ParkedNode extends JsonObject {
  v: number;
  self: Json;
  children: { [name: string]: Json };
}

interface NodeInst {
  iface: AnyIface;
  api: Park & Record<string, unknown>;
  disposers: Array<() => void>;
  children: Map<string, NodeInst | KeyedInst>;
}

interface KeyedInst {
  kind: "keyed";
  iface: AnyIface;
  impl: AnyImpl;
  items: Map<string, NodeInst>;
}

function isKeyedInst(child: NodeInst | KeyedInst): child is KeyedInst {
  return "kind" in child && child.kind === "keyed";
}

export interface Instance<A extends Park = Park> {
  api: A;
  iface: Iface<A, Json>;
  /** Pure snapshot of the whole tree; does not touch the running instance. */
  park(): ParkedNode;
  /** Children-first teardown: drains every effect registered via ctx.effect. */
  dispose(): void;
}

/** Shapes a fresh (no prior state) parked document for an iface tree. */
export function initialDoc(
  iface: AnyIface,
  self: Json,
  children: { [name: string]: Json } = {},
): ParkedNode {
  const shaped: { [name: string]: Json } = {};
  for (const [name, decl] of Object.entries(iface.children)) {
    shaped[name] = children[name] ?? (isKeyed(decl) ? { items: {} } : null);
  }
  return { v: iface.version, self, children: shaped };
}

function parseParkedNode(doc: Json, path: string): ParkedNode {
  if (!isJsonObject(doc) || typeof doc.v !== "number" || doc.self === undefined) {
    throw new BootError(`${path}: not a parked node document`);
  }
  const children = doc.children;
  return {
    v: doc.v,
    self: doc.self,
    children: isJsonObject(children) ? children : {},
  };
}

async function bootNode(
  impl: AnyImpl,
  iface: AnyIface,
  doc: Json,
  resources: Resources,
  path: string,
): Promise<NodeInst> {
  const parked = parseParkedNode(doc, path);
  const parsed = iface.context.strictParse(parked.self, `${path}.self`);
  if (!parsed.ok) {
    throw new BootError(
      `${path}: context does not satisfy iface '${iface.name}' v${iface.version} ` +
        `(dropped=[${parsed.dropped}] missing=[${parsed.missing}] invalid=[${parsed.invalid}])`,
    );
  }

  const childInsts = new Map<string, NodeInst | KeyedInst>();
  const childHandles: Record<string, unknown> = {};
  for (const [name, decl] of Object.entries(iface.children)) {
    const childImpl = impl.children?.[name];
    if (childImpl === undefined) {
      throw new BootError(`${path}: impl provides no child impl for '${name}'`);
    }
    if (isKeyed(decl)) {
      const collection: KeyedInst = {
        kind: "keyed",
        iface: decl.iface,
        impl: childImpl,
        items: new Map(),
      };
      const itemsDoc = isJsonObject(parked.children[name])
        ? (parked.children[name] as JsonObject).items
        : undefined;
      if (isJsonObject(itemsDoc)) {
        for (const [key, itemDoc] of Object.entries(itemsDoc)) {
          collection.items.set(
            key,
            await bootNode(
              childImpl,
              decl.iface,
              itemDoc,
              resources,
              `${path}.children.${name}.items.${key}`,
            ),
          );
        }
      }
      childInsts.set(name, collection);
      childHandles[name] = makeKeyedHandle(collection, resources, `${path}.children.${name}`);
    } else {
      const childDoc = parked.children[name] ?? initialDoc(decl, null);
      const inst = await bootNode(childImpl, decl, childDoc, resources, `${path}.children.${name}`);
      childInsts.set(name, inst);
      childHandles[name] = inst.api;
    }
  }

  const disposers: Array<() => void> = [];
  const ctx: NodeCtx = {
    resources,
    effect: (dispose) => disposers.push(dispose),
  };
  const api = (await impl.create(ctx, parsed.value, childHandles)) as Park &
    Record<string, unknown>;

  // Go-style method-set check, moved to boot time: the impl satisfies the iface
  // implicitly or not at all.
  const missingMethods = iface.methods.filter((m) => typeof api[m] !== "function");
  if (missingMethods.length > 0) {
    throw new BootError(
      `${path}: impl does not satisfy iface '${iface.name}': missing method(s) [${missingMethods.join(", ")}]`,
    );
  }

  return { iface, api, disposers, children: childInsts };
}

function makeKeyedHandle(collection: KeyedInst, resources: Resources, path: string): KeyedHandle {
  return {
    get: (key) => collection.items.get(key)?.api,
    keys: () => [...collection.items.keys()],
    async add(key, context) {
      if (collection.items.has(key))
        throw new BootError(`${path}.items.${key}: key already exists`);
      const doc =
        isJsonObject(context) && typeof context.v === "number"
          ? context
          : initialDoc(collection.iface, context);
      const inst = await bootNode(
        collection.impl,
        collection.iface,
        doc,
        resources,
        `${path}.items.${key}`,
      );
      collection.items.set(key, inst);
      return inst.api;
    },
    remove(key) {
      const inst = collection.items.get(key);
      if (inst === undefined) return;
      collection.items.delete(key);
      disposeNode(inst);
    },
  };
}

function parkNode(node: NodeInst): ParkedNode {
  const children: { [name: string]: Json } = {};
  for (const [name, child] of node.children) {
    if (isKeyedInst(child)) {
      const items: { [key: string]: Json } = {};
      for (const [key, item] of child.items) items[key] = parkNode(item);
      children[name] = { items };
    } else {
      children[name] = parkNode(child);
    }
  }
  return { v: node.iface.version, self: node.api.park(), children };
}

function disposeNode(node: NodeInst): void {
  for (const child of node.children.values()) {
    if (isKeyedInst(child)) {
      for (const item of child.items.values()) disposeNode(item);
      child.items.clear();
    } else {
      disposeNode(child);
    }
  }
  // Reverse order: later effects may depend on earlier ones.
  for (const dispose of node.disposers.reverse()) dispose();
  node.disposers.length = 0;
}

export async function boot<A extends Park, C extends Json>(
  impl: Impl<A, C>,
  iface: Iface<A, C>,
  context: Json,
  resources: Resources,
): Promise<Instance<A>> {
  const root = await bootNode(impl, iface, context, resources, "$");
  return {
    api: root.api as unknown as A,
    iface: iface as Iface<A, Json>,
    park: () => parkNode(root),
    dispose: () => disposeNode(root),
  };
}
