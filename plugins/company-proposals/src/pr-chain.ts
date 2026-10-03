/**
 * The chain through the PR graph, as the organization's handbook defines the one PR stack
 * (the one-PR-stack decision, criterion 2 and its addenda), so that the graph, the
 * CLI and the page read the same chain the deploy line's stack reader does:
 *
 * 1. A node's parent is the open PR whose head branch is its declared base. When the base is the
 *    head branch of a merged PR — or of one closed without merging (1a) — the walk goes on from
 *    that PR's own base until it reaches the base branch or an open PR; the PRs walked through are
 *    the node's `via`, and a closed one is marked, since its commits are still in the node's layer.
 * 2. An edge holds by ancestry, not by `baseRefName`: the head contains its parent's head, or the
 *    commits it lacks carry no content (the parent's tree is the merge base's tree).
 * 2a. A head behind its parent still holds when it forked inside the parent's own layer — the
 *    grandparent's head is an ancestor of the merge base: the parent moved on and the node is
 *    `stale`, waiting for its restack. A fork point below the parent's layer is an old line.
 * 3. At a fork the chain takes the one branch that keeps going (a child with stacked children of
 *    its own); the others are off the chain. When none or several keep going, choosing takes the
 *    record — the roadmap's order — which this plugin does not read: the graph walks every branch,
 *    marks the fork and names no single top. The base branch can carry several stacks this way,
 *    each starting on it and keeping going; every branch walked has its own last layer (`tops`).
 *
 * Everything here is pure: the reader (pr-graph.ts) fetches, buildGraph lays out what it read —
 * each node with its parent, edge and chain verdict, the proposal whose impl it is (by its impl
 * PR, or — an impl branch with no PR — by its head branch) and the PR every other origin has on
 * the same branch, each proposal whose impl is not on the graph with the reason why, and each
 * registered deployment on the layer its commit sits on (deployments.ts).
 */
import type {
  ProposalGraphNode,
  ProposalGraphOffReason,
  ProposalGraphOriginPr,
  ProposalGraphRelation,
  ProposalGraphResponse,
  ProposalGraphUnplacedReason,
  ProposalGraphVia,
  ProposalStatus,
} from "@prismshadow/penguin-server/api";
import { parsePullUrl } from "./pr-status.js";
import { placeDeployment, type DeploymentReading } from "./deployments.js";

/** Hops walked through merged or closed PRs, and nodes walked up a parent line, before giving up. */
const WALK_CAP = 1000;

/** A merged or closed PR found on a branch the walk needed: where the walk goes next. */
export interface ShutPull {
  number: number;
  state: "merged" | "closed";
  base: string;
}

/**
 * The branches looked up so far: the PR found on each, or null when there is none. A branch
 * missing from the map has not been looked up yet.
 */
export type ShutBranches = ReadonlyMap<string, ShutPull | null>;

/** Where the walk from a node's declared base ended. */
export interface Parentage {
  /** The open PR reached, 0 for the base branch, null for neither. */
  parent: number | null;
  via: ProposalGraphVia[];
  /** A branch the walk reached that is in no list yet: look it up and walk again. */
  missing: string | null;
}

/** The parent of every open PR, walking merged and closed PRs through (rules 1 and 1a). */
export function parentsOf(
  pulls: ReadonlyArray<{ number: number; branch: string; base: string }>,
  shut: ShutBranches,
  baseBranch: string,
): Map<number, Parentage> {
  const byBranch = new Map(pulls.map((p) => [p.branch, p.number]));
  const out = new Map<number, Parentage>();
  for (const pull of pulls) {
    const via: ProposalGraphVia[] = [];
    const seen = new Set<string>();
    let branch = pull.base;
    let result: Parentage | null = null;
    while (result === null) {
      const open = byBranch.get(branch);
      if (branch === baseBranch) result = { parent: 0, via, missing: null };
      else if (open !== undefined)
        result = { parent: open === pull.number ? null : open, via, missing: null };
      else if (!shut.has(branch)) result = { parent: null, via, missing: branch };
      else {
        const found = shut.get(branch)!;
        if (found === null || seen.has(branch) || via.length >= WALK_CAP) {
          result = { parent: null, via, missing: null };
        } else {
          seen.add(branch);
          via.push({ number: found.number, state: found.state });
          branch = found.base;
        }
      }
    }
    out.set(pull.number, result);
  }
  return out;
}

/** Where `to` stands against `from` (GitHub's `compare/<from>...<to>`). */
export interface Comparison {
  relation: Exclude<ProposalGraphRelation, "unknown">;
  ahead: number;
  behind: number;
  /** The merge base of the two; null when GitHub did not say. */
  mergeBase: string | null;
  /** `from`'s tree is the merge base's tree: the commits `to` lacks carry no content. */
  empty: boolean;
}

export type EdgeVerdict =
  | { stacked: true; stale: boolean }
  | { stacked: false; reason: Extract<ProposalGraphOffReason, "old-line" | "unread"> };

/**
 * Whether an edge holds (rules 2 and 2a). `edge` compares the parent's head with the node's;
 * `inner` the grandparent's head with their merge base, asked only when the edge alone fails.
 */
export function edgeVerdict(
  edge: Comparison | undefined,
  inner: () => Comparison | undefined,
): EdgeVerdict {
  if (edge === undefined) return { stacked: false, reason: "unread" };
  if (edge.relation === "ahead" || edge.relation === "same") return { stacked: true, stale: false };
  if (edge.empty) return { stacked: true, stale: false };
  const within = edge.mergeBase === null ? undefined : inner();
  if (within !== undefined && (within.relation === "ahead" || within.relation === "same")) {
    return { stacked: true, stale: true };
  }
  return { stacked: false, reason: "old-line" };
}

export interface ChainNode {
  number: number;
  parent: number | null;
  /** The edge to the parent holds. */
  stacked: boolean;
  /** Why it is off already, before the walk: its own edge or its declared base. */
  off: ProposalGraphOffReason | null;
}

export interface Chain {
  /** On the chain, in walk order (each node after its parent). */
  order: number[];
  /** The chain's last layer, or null when it is empty or a fork could not be decided. */
  top: number | null;
  /** The last layer of every branch the walk took, in PR order: one per stack. */
  tops: number[];
  /** Nodes with more than one stacked child; 0 = the base branch. */
  forks: Set<number>;
  /** Why each node off the chain is off, and the node the reason names. */
  off: Map<number, { reason: ProposalGraphOffReason; at: number | null }>;
}

/** Walks the chain from the base branch (rule 3 at each fork) and says why every other node is off it. */
export function walkChain(nodes: readonly ChainNode[]): Chain {
  const byNumber = new Map(nodes.map((n) => [n.number, n]));
  const kids = new Map<number, number[]>();
  for (const n of [...nodes].sort((a, b) => a.number - b.number)) {
    if (n.parent === null || !n.stacked || n.off !== null) continue;
    kids.set(n.parent, [...(kids.get(n.parent) ?? []), n.number]);
  }
  const off = new Map<number, { reason: ProposalGraphOffReason; at: number | null }>();
  const forks = new Set<number>();
  const order: number[] = [];
  const leaves: number[] = [];
  const seen = new Set<number>([0]);
  const todo: number[] = [0];
  while (todo.length > 0) {
    const at = todo.pop()!;
    const children = (kids.get(at) ?? []).filter((k) => !seen.has(k));
    if (children.length === 0) {
      if (at !== 0) leaves.push(at);
      continue;
    }
    if (children.length > 1) forks.add(at);
    const going = children.filter((k) => (kids.get(k)?.length ?? 0) > 0);
    // One child, or the one that keeps going; otherwise undecided — every candidate is walked.
    const taken = children.length === 1 || going.length === 0 ? children : going;
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
    if (onChain.has(n.number) || off.has(n.number)) continue;
    if (n.off !== null) off.set(n.number, { reason: n.off, at: null });
    else if (!n.stacked) off.set(n.number, { reason: "old-line", at: null });
    else if (inCycle(n.number, byNumber)) off.set(n.number, { reason: "cycle", at: null });
    else off.set(n.number, { reason: "above", at: n.parent });
  }
  const tops = [...leaves].sort((a, b) => a - b);
  return { order, top: tops.length === 1 ? tops[0]! : null, tops, forks, off };
}

/** Whether walking up the parents from a node comes back to it. */
function inCycle(start: number, byNumber: ReadonlyMap<number, ChainNode>): boolean {
  let at = byNumber.get(start)?.parent ?? null;
  for (let steps = 0; at !== null && at !== 0 && steps < WALK_CAP; steps++) {
    if (at === start) return true;
    at = byNumber.get(at)?.parent ?? null;
  }
  return false;
}

/** A registered impl PR that is not an open PR on the delivery repository, as GitHub answers it. */
export interface ImplPull {
  state: "open" | "merged" | "closed";
  branch: string;
  head: string;
  base: string;
}

/**
 * Why an impl PR is not on the graph. `pull` is GitHub's answer (null when it could not be read),
 * `onDelivery` whether it is on the delivery repository, `counterpart` the open PR there on the
 * same head branch, `inBase` whether its head is already in the base branch (undefined: unknown).
 */
export function unplacedReason(input: {
  pull: ImplPull | null;
  onDelivery: boolean;
  counterpart: number | null;
  inBase: boolean | undefined;
}): { reason: ProposalGraphUnplacedReason; at: number | null; into: string | null } {
  const { pull } = input;
  if (input.counterpart !== null)
    return { reason: "counterpart", at: input.counterpart, into: null };
  if (pull === null) return { reason: "unread", at: null, into: null };
  if (pull.state === "merged") return { reason: "merged", at: null, into: pull.base };
  if (input.inBase === true) return { reason: "in-base", at: null, into: null };
  if (pull.state === "closed") return { reason: "closed", at: null, into: null };
  // Open on the delivery repository and still not among its open PRs: the list was cut short.
  return { reason: input.onDelivery ? "unread" : "open-elsewhere", at: null, into: null };
}

/** `owner/repo#n`, lower-cased owner and repo: how two URLs of one PR are recognised as one. */
export function pullKey(url: string): string | null {
  const ref = parsePullUrl(url);
  return ref === null ? null : `${ref.owner.toLowerCase()}/${ref.repo.toLowerCase()}#${ref.number}`;
}

/** An open PR as the graph needs it. */
export interface OpenPull {
  number: number;
  url: string;
  title: string;
  draft: boolean;
  branch: string;
  head: string;
  base: string;
}

/** A proposal as the graph annotates with it. */
export interface GraphProposal {
  number: number;
  title: string;
  status: ProposalStatus;
  implPr: string | null;
  /**
   * The declared head of its impl branch: `label` as declared (`<remote>/<branch>`), `repo` the
   * GitHub repository it resolved to (null when it did not). Absent or null for an impl
   * registered as a PR alone.
   */
  implBranch?: { label: string; repo: string | null; branch: string } | null;
}

/** Everything read from GitHub and the ledger, as plain data: what buildGraph lays out. */
export interface GraphInput {
  repo: string;
  base: { branch: string; head: string | null };
  pulls: OpenPull[];
  origins: Array<{ name: string; repo: string; pulls: OpenPull[] | null }>;
  /** The merged or closed PR on each branch a declared base named that no open PR has; absent = not looked up. */
  shut?: ShutBranches;
  /** A comparison read earlier; undefined when it was not (or could not be) read. */
  compare: (from: string, to: string) => Comparison | undefined;
  proposals: GraphProposal[];
  /** An impl PR off the graph as GitHub answered it (by pullKey); null or absent when not read. */
  implPulls?: ReadonlyMap<string, ImplPull | null>;
  /** The registered deployments as read just now (deployments.ts), placed on the layers by their commit. */
  deployments: DeploymentReading[];
  errors: string[];
  checkedAt: string;
}

/** The layout: parents through the declared bases, the chain from the base branch, forks, the top, the annotations. */
export function buildGraph(input: GraphInput): ProposalGraphResponse {
  const repoKey = input.repo.toLowerCase();
  const byKey = new Map<string, GraphProposal>();
  // An impl branch with no PR claims the open PR whose head branch it is on the delivery repository.
  const byHead = new Map<string, GraphProposal>();
  for (const p of input.proposals) {
    if (p.status === "rejected") continue;
    const key = p.implPr === null ? null : pullKey(p.implPr);
    if (key !== null) byKey.set(key, p);
    else if (p.implBranch?.repo != null && p.implBranch.repo.toLowerCase() === repoKey) {
      byHead.set(p.implBranch.branch, p);
    }
  }
  const parents = parentsOf(input.pulls, input.shut ?? new Map(), input.base.branch);
  const byNumber = new Map(input.pulls.map((p) => [p.number, p]));
  const headOf = (n: number | null): string | null =>
    n === null ? null : n === 0 ? input.base.head : (byNumber.get(n)?.head ?? null);

  const nodes = new Map<number, ProposalGraphNode>();
  for (const pull of input.pulls) {
    const { parent, via } = parents.get(pull.number)!;
    const parentHead = headOf(parent);
    const cmp = parentHead === null ? undefined : input.compare(parentHead, pull.head);
    const verdict =
      parent === null
        ? null
        : edgeVerdict(cmp, () => {
            const grand = parent === 0 ? null : headOf(parents.get(parent)?.parent ?? null);
            return grand === null || cmp?.mergeBase == null
              ? undefined
              : input.compare(grand, cmp.mergeBase);
          });
    const proposal = byKey.get(`${repoKey}#${pull.number}`) ?? byHead.get(pull.branch) ?? null;
    nodes.set(pull.number, {
      number: pull.number,
      url: pull.url,
      title: pull.title,
      draft: pull.draft,
      branch: pull.branch,
      head: pull.head,
      base: pull.base,
      parent,
      via,
      relation: cmp?.relation ?? "unknown",
      ahead: cmp?.ahead ?? null,
      behind: cmp?.behind ?? null,
      stacked: verdict?.stacked ?? false,
      stale: verdict?.stacked === true && verdict.stale,
      onChain: false,
      off:
        verdict === null
          ? { reason: "no-base", at: null }
          : verdict.stacked
            ? null
            : { reason: verdict.reason, at: null },
      fork: false,
      proposal:
        proposal === null
          ? null
          : { number: proposal.number, title: proposal.title, status: proposal.status },
      origins: originsOf(input, pull),
    });
  }

  const chain = walkChain(
    [...nodes.values()].map((n) => ({
      number: n.number,
      parent: n.parent,
      stacked: n.stacked,
      off: n.off?.reason ?? null,
    })),
  );
  for (const n of nodes.values()) {
    n.onChain = !chain.off.has(n.number);
    n.off = chain.off.get(n.number) ?? null;
    n.fork = chain.forks.has(n.number);
  }
  const offChain = [...nodes.keys()].filter((n) => chain.off.has(n)).sort((a, b) => a - b);

  const placed = new Set([...nodes.keys()].map((n) => `${repoKey}#${n}`));
  const claimed = new Set(
    [...nodes.values()].flatMap((n) => (n.proposal === null ? [] : [n.proposal.number])),
  );
  const byBranch = new Map(input.pulls.map((p) => [p.branch, p.number]));
  const branchOnly = input.proposals
    .filter((p) => p.status !== "rejected" && p.implPr === null && p.implBranch != null)
    .filter((p) => !claimed.has(p.number))
    .map((p) => ({
      number: p.number,
      title: p.title,
      status: p.status,
      implPr: null,
      branch: p.implBranch!.label,
      reason: (p.implBranch!.repo === null ? "unread" : "no-pr") as ProposalGraphUnplacedReason,
      at: null,
      into: null,
    }));
  const unplaced = input.proposals
    .filter((p) => p.status !== "rejected" && p.implPr !== null)
    .filter((p) => !placed.has(pullKey(p.implPr!) ?? ""))
    .map((p) => {
      const key = pullKey(p.implPr!) ?? "";
      const pull = input.implPulls?.get(key) ?? null;
      const counterpart = pull === null ? null : (byBranch.get(pull.branch) ?? null);
      // Whether its head is already in the base branch is asked only where it decides the reason.
      const head = input.base.head;
      const cmp =
        pull === null || head === null || counterpart !== null || pull.state === "merged"
          ? undefined
          : input.compare(head, pull.head);
      return {
        number: p.number,
        title: p.title,
        status: p.status,
        implPr: p.implPr!,
        branch: p.implBranch?.label ?? null,
        ...unplacedReason({
          pull,
          onDelivery: key.startsWith(`${repoKey}#`),
          counterpart,
          inBase:
            cmp === undefined ? undefined : cmp.relation === "behind" || cmp.relation === "same",
        }),
      };
    });

  return {
    repo: input.repo,
    base: {
      branch: input.base.branch,
      head: input.base.head,
      fork: chain.forks.has(0),
    },
    origins: input.origins.map((o) => ({ name: o.name, repo: o.repo })),
    nodes: [...chain.order, ...offChain].map((n) => nodes.get(n)!),
    top: chain.top,
    tops: chain.tops,
    unplaced: [...unplaced, ...branchOnly].sort((a, b) => a.number - b.number),
    errors: input.errors,
    checkedAt: input.checkedAt,
    deployments: input.deployments.map((deployment) =>
      placeDeployment(
        deployment,
        layersOf(
          input.base.head,
          [...chain.order, ...offChain].map((n) => nodes.get(n)!),
        ),
        input.compare,
      ),
    ),
  };
}

/** The layers a deployment may sit on: the base branch (0) first, then every node in graph order. */
function layersOf(baseHead: string | null, nodes: Array<{ number: number; head: string }>) {
  return [{ number: 0, head: baseHead }, ...nodes.map((n) => ({ number: n.number, head: n.head }))];
}

/** Each origin's open PR on the node's branch, with its head against the node's. */
function originsOf(input: GraphInput, pull: OpenPull): ProposalGraphOriginPr[] {
  const out: ProposalGraphOriginPr[] = [];
  for (const origin of input.origins) {
    if (origin.repo.toLowerCase() === input.repo.toLowerCase()) continue;
    const twin = origin.pulls?.find((p) => p.branch === pull.branch);
    if (twin === undefined) continue;
    const relation: ProposalGraphRelation =
      twin.head === pull.head
        ? "same"
        : (input.compare(pull.head, twin.head)?.relation ?? "unknown");
    out.push({
      origin: origin.name,
      number: twin.number,
      url: twin.url,
      draft: twin.draft,
      head: twin.head,
      relation,
    });
  }
  return out;
}
