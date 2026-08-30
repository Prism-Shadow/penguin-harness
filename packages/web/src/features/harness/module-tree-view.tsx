/**
 * A version's whole module tree, read off its recorded interface table: the groups and
 * the nodes under them, each with what it requires, provides, exports and contributes.
 * Pure rendering over the table — the same data the CI page draws.
 */
import { useEffect, useMemo, useState } from "react";
import * as api from "../../api/endpoints";
import { Badge } from "../../components/ui/badge";
import { Skeleton } from "../../components/ui/skeleton";
import { S } from "../../lib/strings";
import { toneStrip } from "../../lib/tone";

interface Manifest {
  name: string;
  kind?: "module" | "component";
  requires: Record<string, { iface: string; from?: string }>;
  provides: Record<string, string>;
  contributes: Record<string, unknown[]>;
  children: Array<string | { keyed: string }>;
  exports?: string[];
}
interface Table {
  hash: string;
  modules: Record<string, Manifest>;
  ifaces: Record<string, unknown>;
}

type NodeKind = "group" | "module" | "component";
const kindOf = (m: Manifest): NodeKind =>
  m.kind === "component" ? "component" : m.exports?.length ? "group" : "module";
const kindTone: Record<NodeKind, "gray" | "brand" | "green"> = {
  group: "gray",
  module: "brand",
  component: "green",
};
const short = (key: string) => key.slice(key.indexOf("#") + 1);

function Node({
  name,
  table,
  depth,
  selected,
  onSelect,
}: {
  name: string;
  table: Table;
  depth: number;
  selected: string | null;
  onSelect: (name: string) => void;
}) {
  const m = table.modules[name];
  const [openState, setOpen] = useState(depth < 1);
  if (m === undefined) {
    return (
      <li className="text-xs text-gray-400 dark:text-gray-500" style={{ paddingLeft: depth * 16 }}>
        {name}
      </li>
    );
  }
  const kind = kindOf(m);
  const children = m.children.filter((c): c is string => typeof c === "string");
  const wildcard = m.children.length !== children.length;
  return (
    <li>
      <div
        className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-sm ${
          selected === name
            ? "bg-gray-100 dark:bg-gray-800"
            : "hover:bg-gray-50 dark:hover:bg-gray-900"
        }`}
        style={{ paddingLeft: depth * 16 + 6 }}
      >
        {children.length > 0 || wildcard ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={openState}
            aria-label={openState ? S.harnessHistory.collapse : S.harnessHistory.expand}
            className="w-4 text-xs text-gray-400"
          >
            {openState ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-4" />
        )}
        <Badge tone={kindTone[kind]}>{S.harnessHistory.kind[kind]}</Badge>
        <button type="button" onClick={() => onSelect(name)} className="font-mono text-left">
          {name}
        </button>
      </div>
      {openState && (children.length > 0 || wildcard) ? (
        <ul>
          {children.map((c) => (
            <Node
              key={c}
              name={c}
              table={table}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
          {wildcard ? (
            <li
              className="text-xs text-gray-400 dark:text-gray-500"
              style={{ paddingLeft: (depth + 1) * 16 + 26 }}
            >
              {S.harnessHistory.extensionSlot}
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}

function Detail({ name, table }: { name: string; table: Table }) {
  const t = S.harnessHistory;
  const m = table.modules[name];
  if (m === undefined) return null;
  const kind = kindOf(m);
  const req = Object.entries(m.requires);
  const prov = Object.entries(m.provides);
  const contrib = Object.entries(m.contributes);
  const exportsSet = new Set(m.exports ?? []);
  const row = (label: string, body: React.ReactNode) => (
    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="min-w-0">{body}</dd>
    </div>
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Badge tone={kindTone[kind]}>{t.kind[kind]}</Badge>
        <span className="font-mono text-sm">{name}</span>
      </div>
      {row(
        t.requires,
        req.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono">
            {req.map(([f, r]) => (
              <li key={f} title={r.iface}>
                {f}: {short(r.iface)}
                {r.from ? <span className="text-gray-400"> ← {r.from}</span> : null}
              </li>
            ))}
          </ul>
        ),
      )}
      {row(
        kind === "group" ? t.exports : t.provides,
        prov.length === 0 ? (
          <span className="text-gray-400">—</span>
        ) : (
          <ul className="flex flex-col gap-0.5 font-mono">
            {prov.map(([a, k]) => (
              <li key={a} title={k}>
                {a}
                {a !== short(k) ? <span className="text-gray-400">: {short(k)}</span> : null}
                {kind === "group" && !exportsSet.has(a) ? (
                  <span className="text-gray-400"> ({t.ownProvision})</span>
                ) : null}
              </li>
            ))}
          </ul>
        ),
      )}
      {contrib.length > 0
        ? row(
            t.contributes,
            <ul className="flex flex-col gap-0.5 font-mono">
              {contrib.map(([slot, items]) => (
                <li key={slot}>
                  {slot} × {items.length}
                </li>
              ))}
            </ul>,
          )
        : null}
    </div>
  );
}

export function ModuleTreeView({ hash }: { hash: string }) {
  const t = S.harnessHistory;
  const [table, setTable] = useState<Table | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTable(null);
    setError(null);
    setSelected(null);
    void api
      .getVersionIfacesTable(hash)
      .then((data) => {
        if (!cancelled) setTable(data as Table);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);
  const roots = useMemo(() => {
    if (table === null) return [];
    const childOf = new Set<string>();
    for (const m of Object.values(table.modules))
      for (const c of m.children) if (typeof c === "string") childOf.add(c);
    return Object.keys(table.modules).filter((n) => !childOf.has(n));
  }, [table]);
  if (error !== null)
    return (
      <div className={`mt-2 rounded-md border px-3 py-2 text-sm ${toneStrip.danger}`}>{error}</div>
    );
  if (table === null) return <Skeleton className="mt-2 h-9 w-full" />;
  return (
    <div className="mt-2 grid gap-4 md:grid-cols-[minmax(280px,1fr)_minmax(280px,1fr)]">
      <ul className="max-h-[60vh] overflow-y-auto rounded-md border border-gray-200 py-1 dark:border-gray-800">
        {roots.map((r) => (
          <Node
            key={r}
            name={r}
            table={table}
            depth={0}
            selected={selected}
            onSelect={setSelected}
          />
        ))}
      </ul>
      <div className="rounded-md border border-gray-200 px-3 py-2 dark:border-gray-800">
        {selected === null ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.pickNode}</p>
        ) : (
          <Detail name={selected} table={table} />
        )}
      </div>
    </div>
  );
}
