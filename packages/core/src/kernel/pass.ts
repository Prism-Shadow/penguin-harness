/** Pipeable edits over module recipes. Runtime factories remain opaque during compilation. */
import type { IfaceClass } from "./decorators.js";
import type { JsonObject } from "./json.js";
import type { ModuleDef } from "./module.js";
import { ifaceKey } from "./manifest.js";
import type { TableLike } from "./sig.js";

export interface OperatorOrigin {
  pass: string;
  operator: string;
  index: number;
  plugin?: string;
  revision?: string;
  source?: string;
}

export interface ModuleEdit {
  module: string;
  slot?: string;
  removed?: boolean;
  origin: OperatorOrigin;
}

export interface Provision {
  module: string;
  alias: string;
  iface: string;
}

/** The phantom member carries the wrapper's TypeScript type; key is the generated identity. */
export interface InterfaceRef<T> {
  readonly key: string;
  readonly type?: T;
}

export const interfaceRef = <T>(key: string): InterfaceRef<T> => ({ key });
export type Predicate<T> = (value: T) => boolean;
export type ProviderSelector<T> = Predicate<Provision> & { readonly type?: T };

export const provides =
  <T>(ref: InterfaceRef<T>): ProviderSelector<T> =>
  (value: Provision) =>
    value.iface === ref.key;
export const byName =
  (name: string): Predicate<ModuleDef> =>
  (node) =>
    node.manifest.name === name;
export const byId =
  (id: string): Predicate<{ id: string }> =>
  (value) =>
    value.id === id;
export const not =
  <T>(predicate: Predicate<T>): Predicate<T> =>
  (value) =>
    !predicate(value);
export const and =
  <T>(...predicates: Predicate<T>[]): Predicate<T> =>
  (value) =>
    predicates.every((predicate) => predicate(value));
export const or =
  <T>(...predicates: Predicate<T>[]): Predicate<T> =>
  (value) =>
    predicates.some((predicate) => predicate(value));
export const has =
  <T>(predicate: Predicate<T>): Predicate<readonly T[]> =>
  (values) =>
    values.some(predicate);

export interface Decoration {
  select: Predicate<Provision>;
  wrap: (api: unknown, target: Provision) => unknown;
  origin: OperatorOrigin;
}

export interface RewriteCtx {
  readonly ifaces: TableLike;
  /** An escape hatch for custom rewrites; mutations of stored values are not transactional. */
  readonly shared: Map<string, unknown>;
  operation<T>(name: string, run: () => T): T;
  changed(edit: Omit<ModuleEdit, "origin">): void;
  defer(rule: Omit<Decoration, "origin">): void;
}

export type Operator<T> = (input: T, ctx: RewriteCtx) => T;

export interface ModulePass {
  id: string;
  requires?: readonly IfaceClass[];
  source?: string;
  /** Assigned by the plugin host, not inferred from the modules a pass changes. */
  owner?: { plugin: string; revision?: string };
  rewrite(tree: ModuleDef, ctx: RewriteCtx): ModuleDef | Promise<ModuleDef>;
}

export type ModulePassFactory = () => ModulePass;

export function pipe<T>(...operators: readonly Operator<T>[]): Operator<T> {
  return (input, ctx) => operators.reduce((value, operator) => operator(value, ctx), input);
}

export function when<T>(predicate: Predicate<T>, operator: Operator<T>): Operator<T> {
  return (input, ctx) =>
    ctx.operation("when", () => (predicate(input) ? operator(input, ctx) : input));
}

export function filter<T>(
  predicate: Predicate<T>,
): <S extends T>(input: readonly S[], ctx: RewriteCtx) => readonly S[] {
  return (input, ctx) => ctx.operation("filter", () => input.filter(predicate));
}

/** Visit the input children only. Children added by an edit are not revisited. */
function editTree(root: ModuleDef, edit: (node: ModuleDef) => ModuleDef | null): ModuleDef {
  const visit = (node: ModuleDef): ModuleDef | null => {
    const next = edit(node);
    if (next === null || next !== node) return next;
    const children = (node.children ?? []).map(visit).filter((child) => child !== null);
    return children.every((child, index) => child === node.children?.[index]) &&
      children.length === (node.children?.length ?? 0)
      ? node
      : withChildren(node, children);
  };
  const result = visit(root);
  if (result === null) throw new Error("cannot remove the root module");
  return result;
}

function withChildren(node: ModuleDef, children: ModuleDef[]): ModuleDef {
  const names = new Set(children.map((child) => child.manifest.name));
  const declared = node.manifest.children.filter(
    (child) => child === "*" || names.has(typeof child === "string" ? child : child.keyed),
  );
  if (!declared.includes("*")) {
    const previous = new Set(
      declared.map((child) => (typeof child === "string" ? child : child.keyed)),
    );
    for (const name of names) if (!previous.has(name)) declared.push(name);
  }
  return { ...node, manifest: { ...node.manifest, children: declared }, children };
}

export function add(
  select: Predicate<ModuleDef>,
  ...children: readonly ModuleDef[]
): Operator<ModuleDef> {
  return (tree, ctx) =>
    ctx.operation("add", () => {
      const visit = (node: ModuleDef): ModuleDef => {
        const matches = select(node);
        const originalChildren = node.children ?? [];
        const visited = originalChildren.map(visit);
        if (matches) {
          const record = (child: ModuleDef): void => {
            ctx.changed({ module: child.manifest.name });
            for (const nested of child.children ?? []) record(nested);
          };
          for (const child of children) record(child);
          return withChildren(node, [...visited, ...children]);
        }
        return visited.every((child, i) => child === originalChildren[i])
          ? node
          : withChildren(node, visited);
      };
      return visit(tree);
    });
}

export function remove(select: Predicate<ModuleDef>): Operator<ModuleDef> {
  return (tree, ctx) =>
    ctx.operation("remove", () =>
      editTree(tree, (node) => {
        if (!select(node)) return node;
        const record = (removed: ModuleDef): void => {
          ctx.changed({ module: removed.manifest.name, removed: true });
          for (const child of removed.children ?? []) record(child);
        };
        record(node);
        return null;
      }),
    );
}

export function replace(select: Predicate<ModuleDef>, replacement: ModuleDef): Operator<ModuleDef> {
  return (tree, ctx) =>
    ctx.operation("replace", () =>
      editTree(tree, (node) => {
        if (!select(node)) return node;
        if (replacement.manifest.name !== node.manifest.name) {
          throw new Error(
            `replacement '${replacement.manifest.name}' must keep identity '${node.manifest.name}'`,
          );
        }
        const record = (removed: ModuleDef): void => {
          ctx.changed({ module: removed.manifest.name, removed: true });
          for (const child of removed.children ?? []) record(child);
        };
        for (const child of node.children ?? []) record(child);
        ctx.changed({ module: node.manifest.name });
        return replacement;
      }),
    );
}

export interface SlotEntry {
  readonly id: string;
  readonly from: string;
  readonly data: JsonObject;
}

/** Edits a slot in tree/contribution order; owner groups must keep their original order. */
export function at(slot: string, operator: Operator<readonly SlotEntry[]>): Operator<ModuleDef> {
  return (tree, ctx) =>
    ctx.operation(`at(${slot})`, () => {
      const entries: SlotEntry[] = [];
      const collect = (node: ModuleDef): void => {
        for (const { id, ...data } of node.manifest.contributes[slot] ?? []) {
          entries.push(Object.freeze({ id, from: node.manifest.name, data: Object.freeze(data) }));
        }
        for (const child of node.children ?? []) collect(child);
      };
      collect(tree);
      const next = operator(Object.freeze(entries), ctx);
      // A collection edit cannot invent a contributor that does not exist in the input.
      const owners = new Map(
        [...new Set(entries.map((entry) => entry.from))].map((name, index) => [name, index]),
      );
      let previousOwner = -1;
      for (const entry of next) {
        const owner = owners.get(entry.from);
        if (owner === undefined)
          throw new Error(`slot '${slot}': unknown contributor '${entry.from}'`);
        if (owner < previousOwner)
          throw new Error(`slot '${slot}': collection edits must preserve contributor order`);
        previousOwner = owner;
      }
      const group = (values: readonly SlotEntry[]): Map<string, SlotEntry[]> => {
        const grouped = new Map<string, SlotEntry[]>();
        for (const value of values) {
          const list = grouped.get(value.from) ?? [];
          list.push(value);
          grouped.set(value.from, list);
        }
        return grouped;
      };
      const previous = group(entries),
        following = group(next);
      const update = (node: ModuleDef): ModuleDef => {
        const before = previous.get(node.manifest.name) ?? [];
        const after = following.get(node.manifest.name) ?? [];
        const changed =
          before.length !== after.length || before.some((entry, i) => entry !== after[i]);
        const children = node.children?.map(update);
        if (!changed && children?.every((child, i) => child === node.children?.[i]) !== false)
          return node;
        if (changed)
          ctx.changed({ module: node.manifest.name, slot, removed: after.length < before.length });
        return {
          ...node,
          ...(children === undefined ? {} : { children }),
          manifest: changed
            ? {
                ...node.manifest,
                contributes: {
                  ...node.manifest.contributes,
                  [slot]: after.map(({ id, data }) => ({ ...data, id })),
                },
              }
            : node.manifest,
        };
      };
      return update(tree);
    });
}

/** Register now; resolve against the final tree, once, before boot. */
export function decorate<T>(
  select: ProviderSelector<T>,
  wrap: (api: T, target: Provision) => T,
): Operator<ModuleDef> {
  return (tree, ctx) =>
    ctx.operation("decorate", () => {
      ctx.defer({ select, wrap: (api, target) => wrap(api as T, target) });
      return tree;
    });
}

export function provisionsOf(node: ModuleDef): Provision[] {
  const forwarded = new Set(node.manifest.exports ?? []);
  return Object.entries(node.manifest.provides)
    .filter(([alias]) => !forwarded.has(alias))
    .map(([alias, ref]) => ({
      module: node.manifest.name,
      alias,
      iface: ifaceKey(node.manifest.name, ref),
    }));
}
