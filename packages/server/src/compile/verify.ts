/** Batch final structural compatibility questions through the existing TypeScript renderer. */
import type {
  IfaceDecl,
  Mismatch,
  ModuleDef,
  TableLike,
  satisfies,
} from "@prismshadow/penguin-core/kernel";
import { checkTree, ifaceKey, tableOf } from "@prismshadow/penguin-core/kernel";
import { checkAssignments } from "../plugin/iface-check.js";
import { loadTypeScript } from "../plugin/typescript.js";
import { manifestTreeOf, walkDefs } from "./tree.js";

export async function finalCompatibility(
  root: ModuleDef,
  input: TableLike,
): Promise<typeof satisfies> {
  const table = tableOf(input);
  const keys = new Map<IfaceDecl, string>(
    Object.entries(table.ifaces).map(([key, decl]) => [decl, key]),
  );
  const pairs = new Map<string, { from: string; to: string }>();
  const keyOf = (from: IfaceDecl, to: IfaceDecl): string => {
    const a = keys.get(from),
      b = keys.get(to);
    if (a === undefined || b === undefined)
      throw new Error("interface verification: declaration is outside the candidate table");
    return JSON.stringify([a, b]);
  };
  const collect: typeof satisfies = (from, to) => {
    if (from !== to) pairs.set(keyOf(from, to), { from: keys.get(from)!, to: keys.get(to)! });
    return [];
  };
  // This pass only enumerates questions; its provisional answers never admit a tree.
  checkTree(manifestTreeOf(root), input, {}, collect);
  for (const node of walkDefs(root)) {
    for (const alias of node.manifest.exports ?? []) {
      const ref = node.manifest.provides[alias];
      const required =
        ref === undefined ? undefined : table.ifaces[ifaceKey(node.manifest.name, ref)];
      if (required === undefined) continue;
      const offered = (node.children ?? []).flatMap((child) =>
        Object.values(child.manifest.provides)
          .map((key) => table.ifaces[ifaceKey(child.manifest.name, key)])
          .filter((decl) => decl !== undefined),
      );
      if (offered.includes(required)) continue;
      for (const decl of offered) collect(decl, required, input);
    }
  }
  const entries = [...pairs.entries()];
  const answers =
    entries.length === 0
      ? []
      : checkAssignments(
          await loadTypeScript(),
          table,
          entries.map(([, pair]) => pair),
        );
  const results = new Map<string, Mismatch[]>(entries.map(([key], i) => [key, answers[i]!]));
  return (from, to) => {
    if (from === to) return [];
    const result = results.get(keyOf(from, to));
    if (result === undefined)
      throw new Error(
        "interface verification: boot asked a question absent from the compiled candidate",
      );
    return result;
  };
}
