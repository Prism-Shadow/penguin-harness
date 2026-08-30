/**
 * ImplInterface in the Go-interface spirit: a descriptor is pure data
 * (method set + context schema + children shape + migration table). Impls
 * satisfy an iface implicitly — no registration, no inheritance — checked at
 * compile time via `satisfies ImplOf<...>` and at boot time by comparing the
 * method set against the returned api object. Small interfaces compose by
 * embedding; `Park` is the minimal one embedded in every node.
 */
import type { Json } from "./json.js";
import type { Schema } from "./schema.js";

/** The minimal interface every node implements: a pure snapshot. Dispose is separate. */
export interface Park {
  park(): Json;
}

export interface KeyedDecl {
  kind: "keyed";
  iface: AnyIface;
}

export type ChildDecl = AnyIface | KeyedDecl;

export interface Iface<A extends Park = Park, C extends Json = Json> {
  kind: "iface";
  name: string;
  version: number;
  context: Schema<C>;
  /** Runtime-checkable method set (Go's method-set check moved to boot time). */
  methods: readonly string[];
  /** Static tree shape: boot is the only place children are created. */
  children: Record<string, ChildDecl>;
  /** Ships with the code, keyed by fromVersion; chained automatically (1→2→3). */
  migrations: Record<number, (old: Json) => Json>;
  /** Phantom marker carrying the api type (covariant so Instance<Derived> is an Instance<Park>); never a runtime value. */
  api?: A;
}

// Child iface maps are heterogeneous (each entry has its own api/context types);
// the erased form keeps the tree walkable. TODO(schema): arktype-era typing can
// recover per-child types via inference.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyIface = Iface<any, any>;

export function defineIface<A extends Park, C extends Json>(def: {
  name: string;
  version: number;
  context: Schema<C>;
  methods: readonly string[];
  children?: Record<string, ChildDecl>;
  migrations?: Record<number, (old: Json) => Json>;
}): Iface<A, C> {
  return {
    kind: "iface",
    name: def.name,
    version: def.version,
    context: def.context,
    methods: def.methods,
    children: def.children ?? {},
    migrations: def.migrations ?? {},
  };
}

/** Keyed collection: static shape, dynamic cardinality. */
export function keyed(iface: AnyIface): KeyedDecl {
  return { kind: "keyed", iface };
}

export function isKeyed(decl: ChildDecl): decl is KeyedDecl {
  return "kind" in decl && decl.kind === "keyed";
}

/**
 * The serializable interface descriptor — the "platform interface" term of the
 * snapshot equation (snapshot = platform interface + code + state). Pure data:
 * dependency checks compare this without executing any checked code.
 */
export function ifaceData(iface: AnyIface): Json {
  return {
    name: iface.name,
    version: iface.version,
    methods: [...iface.methods],
    context: iface.context.describe(),
    children: Object.fromEntries(
      Object.entries(iface.children).map(([name, decl]) => [
        name,
        isKeyed(decl) ? { keyed: ifaceData(decl.iface) } : ifaceData(decl),
      ]),
    ),
  };
}
