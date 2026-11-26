/**
 * A node of the App's module tree as the process entry holds it across swaps.
 *
 * The entry outlives every generation, so it never keeps a node: it asks the tree of the moment
 * on each use (`boot.tree` follows the current instance, app.ts). But a swap — a push, or the
 * re-assembly a plugin change asks for (a fresh root's first Project lists its preinstalled
 * modules during the admin seed) — disposes the running tree before its successor is built, and
 * a lookup in that window throws. For a request handled outside any framework's catch (the
 * WebSocket handshake, the API socket's liveness check) that throw ended the process. So while
 * the tree cannot answer, the node resolved last stands, as createApp's resolvers already do
 * for the HTTP surface: its state is the runtime's (the database, the auth state), which every
 * generation shares. Before any node has been resolved there is nothing to fall back on, and the
 * lookup's own error is what the caller gets.
 */
import type { ModuleTree } from "@prismshadow/penguin-core/kernel";

export function liveNode<T>(
  boot: { readonly tree: ModuleTree },
  module: string,
  alias: string,
): () => T {
  let last: { node: T } | null = null;
  return () => {
    let node: T;
    try {
      node = boot.tree.api<T>(module, alias);
    } catch (err) {
      if (last === null) throw err;
      return last.node;
    }
    last = { node };
    return node;
  };
}
