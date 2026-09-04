/**
 * The module-tree check: manifests + interface table in, problems out. Nothing here
 * executes module code, so it runs on the sending side of a push (against the target's
 * published table), at boot (before any create), and in CI.
 *
 * Three questions, per module:
 *   1. every `requires` resolves to a visible module whose provided interface
 *      structurally satisfies the required one ({@link satisfies});
 *   2. every contribution names an existing `<module>.<slot>` and parses under that
 *      slot's data schema;
 *   3. every `provides` names an interface the table actually carries.
 *
 * Visibility is lexical: a module sees its siblings, its ancestors and their siblings —
 * not another subtree's internals, and not itself. Anything the host publishes (the
 * runtime's capabilities) is visible everywhere, as a virtual root-level sibling.
 *
 * Ancestors are visible to CONTRIBUTE to (a child fills its parent's slots), not to
 * REQUIRE from: a parent is created after its children, so its api does not exist when
 * a child is created. The booter orders it so; the check refuses the requirement here,
 * before any code runs, rather than letting it surface as a dependency cycle at boot.
 */
import { type } from "arktype";
import type { Json } from "./json.js";
import type { IfaceDecl, TableLike } from "./sig.js";
import { satisfies, tableOf } from "./sig.js";
import type { Manifest } from "./manifest.js";
import { ifaceKey, splitSlotKey } from "./manifest.js";

/** A manifest and its children, as the tree is declared. */
export interface ManifestNode {
  manifest: Manifest;
  children: ManifestNode[];
}

/** What the host publishes: modules with provided interfaces, no manifests of their own. */
export type Published = Record<string /* module name */, Record<string /* alias */, IfaceDecl>>;

export type Problem =
  | { path: string; kind: "unresolved"; alias: string; from: string; why: string }
  | { path: string; kind: "mismatch"; alias: string; from: string; method: string; why: string }
  | { path: string; kind: "unknown-iface"; alias: string; ref: string }
  | { path: string; kind: "no-such-slot"; slotKey: string }
  | { path: string; kind: "bad-contribution"; slotKey: string; id: string; why: string }
  | { path: string; kind: "duplicate-id"; id: string; other: string }
  | { path: string; kind: "duplicate-module"; name: string; other: string };

interface Located {
  path: string;
  manifest: Manifest;
  /** Module names this module may wire to or contribute to. */
  visible: Set<string>;
  /** Module names above this one — never a provider for it (their exports face outward). */
  ancestors: Set<string>;
}

/** Provided interfaces of a module, by alias, resolved through the table. */
function provided(
  manifest: Manifest,
  table: TableLike,
): { byAlias: Record<string, IfaceDecl>; unknown: Array<{ alias: string; ref: string }> } {
  const byAlias: Record<string, IfaceDecl> = {};
  const unknown: Array<{ alias: string; ref: string }> = [];
  for (const [alias, ref] of Object.entries(manifest.provides)) {
    const decl = tableOf(table).ifaces[ifaceKey(manifest.name, ref)];
    if (decl === undefined) unknown.push({ alias, ref });
    else byAlias[alias] = decl;
  }
  return { byAlias, unknown };
}

function locate(root: ManifestNode): Located[] {
  const out: Located[] = [];
  const walk = (node: ManifestNode, path: string, inherited: string[], above: string[]) => {
    const siblings = node.children.map((c) => c.manifest.name);
    const ancestors = new Set([...above, node.manifest.name]);
    for (const child of node.children) {
      const childPath = `${path}/${child.manifest.name}`;
      const visible = new Set([...inherited, node.manifest.name, ...siblings]);
      out.push({ path: childPath, manifest: child.manifest, visible, ancestors });
      walk(child, childPath, [...inherited, node.manifest.name, ...siblings], [...ancestors]);
    }
  };
  out.push({
    path: `/${root.manifest.name}`,
    manifest: root.manifest,
    visible: new Set(),
    ancestors: new Set(),
  });
  walk(root, `/${root.manifest.name}`, [], []);
  return out;
}

export interface CheckResult {
  problems: Problem[];
  /** Module name → its provided interfaces by alias (the tree's own plus the published). */
  provides: Record<string, Record<string, IfaceDecl>>;
}

export function checkTree(
  root: ManifestNode,
  table: TableLike,
  published: Published = {},
): CheckResult {
  const problems: Problem[] = [];
  const located = locate(root);
  const byName = new Map<string, Located>();
  for (const m of located) {
    const other = byName.get(m.manifest.name);
    if (other !== undefined) {
      problems.push({
        path: m.path,
        kind: "duplicate-module",
        name: m.manifest.name,
        other: other.path,
      });
      continue;
    }
    byName.set(m.manifest.name, m);
  }
  const provides: Record<string, Record<string, IfaceDecl>> = { ...published };
  for (const m of byName.values()) {
    const { byAlias, unknown } = provided(m.manifest, table);
    for (const u of unknown) problems.push({ path: m.path, kind: "unknown-iface", ...u });
    provides[m.manifest.name] = byAlias;
  }
  const ids = new Map<string, string>();
  for (const m of byName.values()) {
    const mf = m.manifest;
    for (const [alias, need] of Object.entries(mf.requires)) {
      const required = tableOf(table).ifaces[ifaceKey(mf.name, need.iface)];
      if (required === undefined) {
        problems.push({ path: m.path, kind: "unknown-iface", alias, ref: need.iface });
        continue;
      }
      const requirable = (from: string) =>
        (m.visible.has(from) && !m.ancestors.has(from)) || from in published;
      const candidates =
        need.from !== undefined
          ? [need.from]
          : [...m.visible, ...Object.keys(published)].filter(
              (name) => name !== mf.name && !m.ancestors.has(name),
            );
      const matches: string[] = [];
      // Providers that DECLARE this very interface (the same table entry): when exactly
      // one does, it wins over the others that merely have the shape.
      const declared: string[] = [];
      let lastMismatch: { from: string; method: string; why: string } | null = null;
      for (const from of candidates) {
        if (!requirable(from)) continue;
        const offered = provides[from];
        if (offered === undefined) continue;
        let satisfied = false;
        for (const decl of Object.values(offered)) {
          const gaps = satisfies(decl, required, table);
          if (gaps.length === 0) {
            satisfied = true;
            if (decl === required) declared.push(from);
            continue;
          }
          lastMismatch = { from, method: gaps[0]!.method, why: gaps[0]!.why };
        }
        if (satisfied) matches.push(from);
      }
      if (matches.length === 1 || declared.length === 1) continue;
      if (need.from !== undefined) {
        const from = need.from;
        if (!requirable(from) || provides[from] === undefined) {
          problems.push({
            path: m.path,
            kind: "unresolved",
            alias,
            from,
            why: m.ancestors.has(from)
              ? "an ancestor — created after its children, so its api is not there yet"
              : from === mf.name
                ? "itself"
                : byName.has(from)
                  ? "not visible from here"
                  : "no such module",
          });
        } else if (lastMismatch !== null) {
          problems.push({ path: m.path, kind: "mismatch", alias, ...lastMismatch });
        } else {
          problems.push({ path: m.path, kind: "unresolved", alias, from, why: "provides nothing" });
        }
      } else {
        problems.push({
          path: m.path,
          kind: "unresolved",
          alias,
          from: "",
          why:
            matches.length === 0
              ? "no visible module provides an interface satisfying it"
              : `ambiguous: ${matches.join(", ")} all satisfy it — name one with 'from'`,
        });
      }
    }
    for (const [slotKey, entries] of Object.entries(mf.contributes)) {
      const split = splitSlotKey(slotKey);
      const target = split === null ? undefined : provides[split.module];
      const slot =
        split === null || target === undefined
          ? undefined
          : Object.values(target)
              .map((decl) => decl.slots[split.slot])
              .find((s) => s !== undefined);
      if (slot === undefined) {
        problems.push({ path: m.path, kind: "no-such-slot", slotKey });
        continue;
      }
      let schema: ((v: unknown) => unknown) | null = null;
      try {
        schema = type.raw(inlineRefs(slot.data, tableOf(table).types)).onUndeclaredKey("reject");
      } catch (err) {
        problems.push({
          path: m.path,
          kind: "bad-contribution",
          slotKey,
          id: "*",
          why: `slot schema is not an arktype definition: ${err instanceof Error ? err.message : String(err)}`,
        });
        continue;
      }
      for (const entry of entries) {
        const other = ids.get(entry.id);
        if (other !== undefined) {
          problems.push({ path: m.path, kind: "duplicate-id", id: entry.id, other });
        } else {
          ids.set(entry.id, m.path);
        }
        const { id: _id, ...data } = entry;
        const out = schema(data);
        if (out instanceof type.errors) {
          problems.push({
            path: m.path,
            kind: "bad-contribution",
            slotKey,
            id: entry.id,
            why: out.summary,
          });
        }
      }
    }
  }
  return { problems, provides };
}

/** A definition with its `$ref`s substituted, for arktype (which knows no references); a cycle stays a reference and parses as `unknown`. */
export function inlineRefs(def: Json, types: Record<string, Json>, stack: string[] = []): Json {
  if (Array.isArray(def)) return def.map((d) => inlineRefs(d, types, stack));
  if (def !== null && typeof def === "object") {
    const keys = Object.keys(def);
    if (keys.length === 1 && keys[0] === "$ref" && typeof def.$ref === "string") {
      const name = def.$ref;
      const target = types[name];
      if (target === undefined || stack.includes(name)) return "unknown";
      return inlineRefs(target, types, [...stack, name]);
    }
    return Object.fromEntries(
      Object.entries(def).map(([k, v]) => [k, inlineRefs(v, types, stack)]),
    );
  }
  return def;
}

export function describeProblem(p: Problem): string {
  switch (p.kind) {
    case "unresolved":
      return `${p.path}: requires.${p.alias}${p.from ? ` from '${p.from}'` : ""}: ${p.why}`;
    case "mismatch":
      return `${p.path}: requires.${p.alias} from '${p.from}': ${p.method}: ${p.why}`;
    case "unknown-iface":
      return `${p.path}: '${p.alias}' names interface '${p.ref}', which the table does not carry`;
    case "no-such-slot":
      return `${p.path}: contributes to '${p.slotKey}', which no visible module declares`;
    case "bad-contribution":
      return `${p.path}: contribution '${p.id}' to '${p.slotKey}': ${p.why}`;
    case "duplicate-id":
      return `${p.path}: contribution id '${p.id}' is already used by ${p.other}`;
    case "duplicate-module":
      return `${p.path}: module name '${p.name}' is already used by ${p.other}`;
  }
}
