/**
 * What changed between two interface tables (ifaces.json): the nodes of the tree, their
 * manifests, and the interfaces themselves at signature level. Pure — both tables are
 * data, and the diff is data too, so the history page can show a push as "what it changed"
 * rather than as a hash.
 */

interface Table {
  hash?: string;
  ifaces: Record<string, IfaceDecl>;
  types: Record<string, unknown>;
  modules: Record<string, Manifest>;
}
interface IfaceDecl {
  name: string;
  methods: Record<string, unknown>;
  fields?: Record<string, unknown>;
  slots?: Record<string, unknown>;
}
interface Manifest {
  name: string;
  kind?: string;
  requires: Record<string, { iface: string; from?: string }>;
  provides: Record<string, string>;
  contributes: Record<string, unknown[]>;
  children: unknown[];
  exports?: string[];
}

export interface MemberChange {
  name: string;
  change: "added" | "removed" | "changed";
}

export interface IfaceChange {
  key: string;
  change: "added" | "removed" | "changed";
  methods: MemberChange[];
  fields: MemberChange[];
  slots: MemberChange[];
}

export interface ModuleChange {
  name: string;
  change: "added" | "removed" | "changed";
  /** Requirement aliases whose interface or wiring changed. */
  requires: MemberChange[];
  provides: MemberChange[];
  /** Slot keys whose contribution list changed. */
  contributes: MemberChange[];
  children: MemberChange[];
  exports: MemberChange[];
  kind: { from: string | null; to: string | null } | null;
}

export interface IfacesDiff {
  from: string | null;
  to: string | null;
  modules: ModuleChange[];
  ifaces: IfaceChange[];
  types: { added: number; removed: number; changed: number };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function members(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): MemberChange[] {
  const out: MemberChange[] = [];
  const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
  for (const name of [...keys].sort()) {
    const x = a?.[name];
    const y = b?.[name];
    if (x === undefined) out.push({ name, change: "added" });
    else if (y === undefined) out.push({ name, change: "removed" });
    else if (!same(x, y)) out.push({ name, change: "changed" });
  }
  return out;
}

const listAsRecord = (list: unknown[] | undefined): Record<string, unknown> =>
  Object.fromEntries(
    (list ?? []).map((v) => [typeof v === "string" ? v : JSON.stringify(v), true]),
  );

/** The changes from table `a` to table `b`; either may be null (nothing recorded on that side). */
export function diffIfaces(a: Table | null, b: Table | null): IfacesDiff {
  const A = a ?? { ifaces: {}, types: {}, modules: {} };
  const B = b ?? { ifaces: {}, types: {}, modules: {} };
  const modules: ModuleChange[] = [];
  for (const name of [...new Set([...Object.keys(A.modules), ...Object.keys(B.modules)])].sort()) {
    const x = A.modules[name];
    const y = B.modules[name];
    if (x === undefined || y === undefined) {
      modules.push({
        name,
        change: x === undefined ? "added" : "removed",
        requires: [],
        provides: [],
        contributes: [],
        children: [],
        exports: [],
        kind: null,
      });
      continue;
    }
    const c: ModuleChange = {
      name,
      change: "changed",
      requires: members(x.requires, y.requires),
      provides: members(x.provides, y.provides),
      contributes: members(x.contributes, y.contributes),
      children: members(listAsRecord(x.children), listAsRecord(y.children)),
      exports: members(listAsRecord(x.exports), listAsRecord(y.exports)),
      kind:
        (x.kind ?? null) === (y.kind ?? null) ? null : { from: x.kind ?? null, to: y.kind ?? null },
    };
    if (
      c.requires.length +
        c.provides.length +
        c.contributes.length +
        c.children.length +
        c.exports.length >
        0 ||
      c.kind !== null
    )
      modules.push(c);
  }
  const ifaces: IfaceChange[] = [];
  for (const key of [...new Set([...Object.keys(A.ifaces), ...Object.keys(B.ifaces)])].sort()) {
    const x = A.ifaces[key];
    const y = B.ifaces[key];
    if (x === undefined || y === undefined) {
      ifaces.push({
        key,
        change: x === undefined ? "added" : "removed",
        methods: [],
        fields: [],
        slots: [],
      });
      continue;
    }
    const c: IfaceChange = {
      key,
      change: "changed",
      methods: members(x.methods, y.methods),
      fields: members(x.fields, y.fields),
      slots: members(x.slots, y.slots),
    };
    if (c.methods.length + c.fields.length + c.slots.length > 0) ifaces.push(c);
  }
  const t = members(A.types, B.types);
  return {
    from: a?.hash ?? null,
    to: b?.hash ?? null,
    modules,
    ifaces,
    types: {
      added: t.filter((m) => m.change === "added").length,
      removed: t.filter((m) => m.change === "removed").length,
      changed: t.filter((m) => m.change === "changed").length,
    },
  };
}

/** The summary a stored table carries in the history: its hash and what it describes. */
export function summarizeTable(table: Table): {
  hash: string;
  nodes: number;
  interfaces: number;
  types: number;
} {
  return {
    hash: table.hash ?? "",
    nodes: Object.keys(table.modules).length,
    interfaces: Object.keys(table.ifaces).length,
    types: Object.keys(table.types).length,
  };
}
