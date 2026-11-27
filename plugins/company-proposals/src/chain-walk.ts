/**
 * The walk of the PR graph's chain (rule 3 of pr-chain.ts), over nodes whose parents and edge
 * verdicts are already decided:
 *
 * - On the base branch every line is a stack of its own. Each child hanging straight from it
 *   whose edge holds is on the chain — a single PR that goes no further is a standalone stack,
 *   not a branch the walk passed over — so the base never has a `not-taken` child.
 * - Inside a stack, at a fork the chain takes the one child that keeps going (a child with
 *   stacked children of its own); the others are `not-taken`. When none or several keep going,
 *   choosing takes the record — the roadmap's order — which this plugin does not read: every
 *   candidate is walked, the fork is marked and no single top is named.
 *
 * Every branch walked ends in a last layer (`tops`), one per stack and per undecided fork.
 */
import type { ProposalGraphOffReason } from "@prismshadow/penguin-server/api";
import { BASE_KEY } from "./graph-heads.js";

/** Hops walked through merged or closed PRs, and nodes walked up a parent line, before giving up. */
export const WALK_CAP = 1000;

export interface ChainNode {
  key: string;
  parent: string | null;
  /** The edge to the parent holds. */
  stacked: boolean;
  /** Why it is off already, before the walk: its own edge or its declared base. */
  off: ProposalGraphOffReason | null;
}

export interface Chain {
  /** On the chain, in walk order (each node after its parent). */
  order: string[];
  /** The chain's last layer, or null when it is empty or has several (stacks, an undecided fork). */
  top: string | null;
  /** The last layer of every branch the walk took, in the nodes' order: one per stack. */
  tops: string[];
  /** Nodes with more than one stacked child; BASE_KEY = the base branch. */
  forks: Set<string>;
  /** Why each node off the chain is off, and the node the reason names. */
  off: Map<string, { reason: ProposalGraphOffReason; at: string | null }>;
}

/**
 * Walks the chain from the base branch and says why every other node is off it. The nodes come
 * in drawing order (graph-heads.ts); siblings and tops keep that order.
 */
export function walkChain(nodes: readonly ChainNode[]): Chain {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const rank = new Map(nodes.map((n, i) => [n.key, i]));
  const kids = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.parent === null || !n.stacked || n.off !== null) continue;
    kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.key]);
  }
  const off = new Map<string, { reason: ProposalGraphOffReason; at: string | null }>();
  const forks = new Set<string>();
  const order: string[] = [];
  const leaves: string[] = [];
  const seen = new Set<string>([BASE_KEY]);
  const todo: string[] = [BASE_KEY];
  while (todo.length > 0) {
    const at = todo.pop()!;
    const children = (kids.get(at) ?? []).filter((k) => !seen.has(k));
    if (children.length === 0) {
      if (at !== BASE_KEY) leaves.push(at);
      continue;
    }
    if (children.length > 1) forks.add(at);
    const going = children.filter((k) => (kids.get(k)?.length ?? 0) > 0);
    // The base's children are each a stack; inside a stack, one child or the one that keeps
    // going — otherwise undecided, and every candidate is walked.
    const taken = at === BASE_KEY || children.length === 1 || going.length === 0 ? children : going;
    for (const k of children) {
      seen.add(k);
      if (taken.includes(k)) {
        order.push(k);
        todo.push(k);
      } else off.set(k, { reason: "not-taken", at });
    }
  }

  // Everything else: its own reason, or the reason of the line it hangs from.
  const onChain = new Set(order);
  for (const n of nodes) {
    if (onChain.has(n.key) || off.has(n.key)) continue;
    if (n.off !== null) off.set(n.key, { reason: n.off, at: null });
    else if (!n.stacked) off.set(n.key, { reason: "old-line", at: null });
    else if (inCycle(n.key, byKey)) off.set(n.key, { reason: "cycle", at: null });
    else off.set(n.key, { reason: "above", at: n.parent });
  }
  const tops = [...leaves].sort((a, b) => rank.get(a)! - rank.get(b)!);
  return { order, top: tops.length === 1 ? tops[0]! : null, tops, forks, off };
}

/** Whether walking up the parents from a node comes back to it. */
function inCycle(start: string, byKey: ReadonlyMap<string, ChainNode>): boolean {
  let at = byKey.get(start)?.parent ?? null;
  for (let steps = 0; at !== null && at !== BASE_KEY && steps < WALK_CAP; steps++) {
    if (at === start) return true;
    at = byKey.get(at)?.parent ?? null;
  }
  return false;
}
