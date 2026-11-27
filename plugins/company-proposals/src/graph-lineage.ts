/**
 * Which node heads contain which, for rule 1b of the chain (pr-chain.ts): a node whose declared
 * base is the base branch itself takes as its parent the nearest of the other nodes its head
 * contains. Branches are commonly registered against the base branch whatever they are stacked
 * on, so the declared base alone would hang every one of them directly on it.
 *
 * A refresh walks once over the commits the heads have beyond the base tip
 * (`git rev-list --parents <heads> --not <base>`, GitMirror.commitsBeyond) and works out the
 * reachability in memory — no git call per pair. The result is stored with the other facts
 * (GraphStore.lineage), so a read lays it out without git.
 */
import type { GraphHead } from "./graph-heads.js";
import type { Parentage } from "./pr-chain.js";

/**
 * For each head walked: every other head it contains, with the number of commits beyond the
 * base between the two. A head missing from the map was not walked (its ancestry is unread);
 * a head walked that contains none has an empty map.
 */
export type Lineage = ReadonlyMap<string, ReadonlyMap<string, number>>;

/**
 * The lineage of `heads` from the commits they have beyond the base (`commit → parents`, as
 * `rev-list --parents` lists them; a parent outside the map is on the base's history). A head
 * not in the map is on the base's history itself: walked, beyond the base by nothing.
 */
export function lineageOf(
  heads: readonly string[],
  commits: ReadonlyMap<string, readonly string[]>,
): Map<string, Map<string, number>> {
  const ids = new Map<string, number>();
  for (const sha of commits.keys()) ids.set(sha.toLowerCase(), ids.size);
  const parents: number[][] = Array.from({ length: ids.size }, () => []);
  for (const [sha, ps] of commits) {
    const at = parents[ids.get(sha.toLowerCase())!]!;
    for (const p of ps) {
      const id = ids.get(p.toLowerCase());
      if (id !== undefined) at.push(id);
    }
  }
  // Which commit is which head (several heads may share one), and how far each head reaches.
  const headsAt = new Map<number, string[]>();
  for (const h of heads) {
    const id = ids.get(h.toLowerCase());
    if (id !== undefined) headsAt.set(id, [...(headsAt.get(id) ?? []), h]);
  }
  const depth = new Map<string, number>();
  const reached = new Map<string, string[]>();
  // One walk per head over the commits beyond the base; a stamp per walk instead of a fresh set.
  const stamp = new Int32Array(ids.size);
  let walk = 0;
  for (const h of new Set(heads)) {
    const start = ids.get(h.toLowerCase());
    if (start === undefined) {
      depth.set(h, 0);
      reached.set(h, []);
      continue;
    }
    walk++;
    let count = 0;
    const found: string[] = [];
    const todo = [start];
    stamp[start] = walk;
    while (todo.length > 0) {
      const at = todo.pop()!;
      count++;
      for (const other of headsAt.get(at) ?? []) if (other !== h) found.push(other);
      for (const p of parents[at]!) {
        if (stamp[p] === walk) continue;
        stamp[p] = walk;
        todo.push(p);
      }
    }
    depth.set(h, count);
    reached.set(h, found);
  }
  const out = new Map<string, Map<string, number>>();
  for (const [h, found] of reached) {
    const mine = depth.get(h)!;
    out.set(
      h,
      new Map(
        found
          .filter((a) => a.toLowerCase() !== h.toLowerCase())
          .map((a) => [a, mine - depth.get(a)!] as const),
      ),
    );
  }
  return out;
}

/**
 * The nearest node a head contains (rule 1b): among the other nodes, the one whose head is an
 * ancestor of this head with the fewest commits between, the first in drawing order on a tie.
 * A node on the same commit is not its ancestor. Null when there is none (the node hangs on the
 * base branch); undefined when the head was not walked.
 */
export function nearestAncestor(
  head: Pick<GraphHead, "key" | "head">,
  heads: ReadonlyArray<Pick<GraphHead, "key" | "head">>,
  lineage: Lineage,
): string | null | undefined {
  const mine = lineage.get(head.head);
  if (mine === undefined) return undefined;
  let best: { key: string; distance: number } | null = null;
  for (const other of heads) {
    if (other.key === head.key || other.head === head.head) continue;
    const distance = mine.get(other.head);
    if (distance === undefined) continue;
    if (best === null || distance < best.distance) best = { key: other.key, distance };
  }
  return best?.key ?? null;
}

/**
 * Rule 1b over every node declared on the base branch: the nearest node its head contains
 * becomes its parent in `parents`. Returns the nodes whose head was not walked (`unread`).
 */
export function adoptNearest(
  parents: Map<string, Parentage>,
  heads: ReadonlyArray<Pick<GraphHead, "key" | "head" | "base">>,
  baseBranch: string,
  lineage: Lineage,
): Set<string> {
  const unwalked = new Set<string>();
  for (const head of heads) {
    if (head.base !== baseBranch) continue;
    const nearest = nearestAncestor(head, heads, lineage);
    if (nearest === undefined) unwalked.add(head.key);
    else if (nearest !== null) parents.set(head.key, { parent: nearest, via: [], missing: null });
  }
  return unwalked;
}
