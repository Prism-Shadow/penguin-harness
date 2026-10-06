/**
 * The chain through the PR graph, as the organization's handbook defines the one PR stack
 * (the one-PR-stack decision, criterion 2 and its addenda), so that the graph, the
 * CLI and the page read the same chain the deploy line's stack reader does:
 *
 * 1. A node's parent is the node whose head branch is its declared base. When the base is the
 *    head branch of a merged PR — or of one closed without merging (1a) — the walk goes on from
 *    that PR's own base until it reaches the base branch or a node; the PRs walked through are
 *    the node's `via`, and a closed one is marked, since its commits are still in the node's layer.
 * 1b. A declared base that is the base branch itself does not decide: branches are registered
 *    against it whatever they are stacked on (every impl branch here, and open PRs alike). The
 *    parent is then, among the other nodes, the one whose head is an ancestor of this head and
 *    nearest to it — the fewest commits between (graph-lineage.ts) — and the base branch only
 *    when there is none. The ancestry is read in the mirror at refresh time and stored with the
 *    facts; a head it was not read for is `unread`. Rules 2 to 2b judge the parent chosen so.
 * 2. An edge holds by ancestry, not by `baseRefName`: the head contains its parent's head, or the
 *    commits it lacks carry no content (the parent's tree is the merge base's tree).
 * 2a. A head behind its parent still holds when it forked inside the parent's own layer — the
 *    grandparent's head is an ancestor of the merge base: the parent moved on and the node is
 *    `stale`, waiting for its restack. A fork point below the parent's layer is an old line.
 * 2b. The bottom layer's parent is the base branch, whose own layer is its whole history: a head
 *    behind the base tip still holds when its merge base with the tip is on that history — the
 *    base moved on after the stack was built. The node is `stale`, its `behind` the commits the
 *    base gained, and the layers above it stay on the chain: one move of the base does not scatter
 *    the graph. Only a head with no fork point on the base's history (no merge base) is an old line.
 * 3. At a fork inside a stack the chain takes the one branch that keeps going (a child with
 *    stacked children of its own); the others are `not-taken`. When none or several keep going,
 *    choosing takes the record — the roadmap's order — which this plugin does not read: the graph
 *    walks every branch, marks the fork and names no single top.
 * 3a. Rule 3 does not apply on the base branch: every line hanging straight from it is a stack of
 *    its own and is never `not-taken` — a single PR that goes no further is a standalone stack.
 *    Every branch walked has its own last layer (`tops`). The walk itself is chain-walk.ts.
 *
 * The nodes are the heads graph-heads.ts lists — open PRs and the impl branches no open PR claims
 * — keyed by head branch. Everything here is pure: the reader (pr-graph.ts) fetches, buildGraph
 * lays out what it read — each node with its parent, edge and chain verdict, the proposal whose
 * impl it is and the PR every other origin has on the same branch, each proposal whose impl is
 * not on the graph with the reason why, each registered deployment on the layer its commit
 * sits on (deployments.ts), and the rows the graph is drawn in (smartlog.ts). An off-chain node
 * whose base names no node also says what fixing it takes (off-detail.ts).
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
import { placeDeployment, type DeploymentReading } from "./deployments.js";
import { BASE_KEY, headsOf, pullKey, type GraphHead } from "./graph-heads.js";
import { WALK_CAP, walkChain } from "./chain-walk.js";
import { adoptNearest, type Lineage } from "./graph-lineage.js";
import { addOffDetails } from "./off-detail.js";
import { ownRows, smartlogRows } from "./smartlog.js";

export { pullKey };

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
  /** The node reached (its key), BASE_KEY for the base branch, null for neither. */
  parent: string | null;
  via: ProposalGraphVia[];
  /** A branch the walk reached that is in no list yet: look it up and walk again. */
  missing: string | null;
}

/** The parent of every node, walking merged and closed PRs through (rules 1 and 1a). */
export function parentsOf(
  heads: ReadonlyArray<{ key: string; branch: string; base: string }>,
  shut: ShutBranches,
  baseBranch: string,
): Map<string, Parentage> {
  // A branch two heads have (a PR from another repository) leads to the first: the one keyed by it.
  const byBranch = new Map<string, string>();
  for (const h of heads) if (!byBranch.has(h.branch)) byBranch.set(h.branch, h.key);
  const out = new Map<string, Parentage>();
  for (const head of heads) {
    const via: ProposalGraphVia[] = [];
    const seen = new Set<string>();
    let branch = head.base;
    let result: Parentage | null = null;
    while (result === null) {
      const open = byBranch.get(branch);
      if (branch === baseBranch) result = { parent: BASE_KEY, via, missing: null };
      else if (open !== undefined)
        result = { parent: open === head.key ? null : open, via, missing: null };
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
    out.set(head.key, result);
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
 * Whether an edge holds (rules 2, 2a and 2b). `edge` compares the parent's head with the node's;
 * `inner` the grandparent's head with their merge base, asked only when the edge alone fails and
 * the parent is a node. For the base branch (`onBase`) the merge base itself decides: it is a
 * commit of the base tip's history by definition, so having one is being forked on that history.
 */
export function edgeVerdict(
  edge: Comparison | undefined,
  inner: () => Comparison | undefined,
  onBase = false,
): EdgeVerdict {
  if (edge === undefined) return { stacked: false, reason: "unread" };
  if (edge.relation === "ahead" || edge.relation === "same") return { stacked: true, stale: false };
  if (edge.empty) return { stacked: true, stale: false };
  if (onBase) {
    return edge.mergeBase === null
      ? { stacked: false, reason: "old-line" }
      : { stacked: true, stale: true };
  }
  const within = edge.mergeBase === null ? undefined : inner();
  if (within !== undefined && (within.relation === "ahead" || within.relation === "same")) {
    return { stacked: true, stale: true };
  }
  return { stacked: false, reason: "old-line" };
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
   * GitHub repository it resolved to (null when it did not), `base` the branch of the base side
   * it registered (null: none, the graph's base branch stands in). Absent or null for an impl
   * registered as a PR alone.
   */
  implBranch?: {
    label: string;
    repo: string | null;
    branch: string;
    base?: string | null;
  } | null;
}

/** Everything read from GitHub and the ledger, as plain data: what buildGraph lays out. */
export interface GraphInput {
  repo: string;
  base: { branch: string; head: string | null };
  pulls: OpenPull[];
  origins: Array<{ name: string; repo: string; pulls: OpenPull[] | null }>;
  /** The merged or closed PR on each branch a declared base named that no node has; absent = not looked up. */
  shut?: ShutBranches;
  /** The tip of each impl branch on the delivery repository (graph-heads.ts); absent or missing = not read. */
  tips?: ReadonlyMap<string, string>;
  /**
   * Which node heads contain which (graph-lineage.ts), for the nodes declared on the base branch
   * (rule 1b). Absent: no ancestry is considered and the declared base decides alone.
   */
  lineage?: Lineage;
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

/**
 * The layout: parents through the declared bases or, declared on the base branch, the nearest
 * ancestor (1b); the chain from the base branch, forks, the top, the annotations.
 */
export function buildGraph(input: GraphInput): ProposalGraphResponse {
  const repoKey = input.repo.toLowerCase();
  const { heads, unplaced: branchUnplaced } = headsOf({
    repo: input.repo,
    baseBranch: input.base.branch,
    pulls: input.pulls,
    proposals: input.proposals,
    tips: input.tips ?? new Map(),
  });
  const parents = parentsOf(heads, input.shut ?? new Map(), input.base.branch);
  const unwalked =
    input.lineage === undefined
      ? new Set<string>()
      : adoptNearest(parents, heads, input.base.branch, input.lineage);
  const byKey = new Map(heads.map((h) => [h.key, h]));
  const headOf = (k: string | null): string | null =>
    k === null ? null : k === BASE_KEY ? input.base.head : (byKey.get(k)?.head ?? null);

  const nodes = new Map<string, ProposalGraphNode>();
  for (const head of heads) {
    const { parent, via } = parents.get(head.key)!;
    const parentHead = headOf(parent);
    // A head whose ancestry was not read has no parent to compare with yet: `unread`.
    const cmp =
      parentHead === null || unwalked.has(head.key)
        ? undefined
        : input.compare(parentHead, head.head);
    const verdict =
      parent === null
        ? null
        : edgeVerdict(
            cmp,
            () => {
              const grand = headOf(parents.get(parent)?.parent ?? null);
              return grand === null || cmp?.mergeBase == null
                ? undefined
                : input.compare(grand, cmp.mergeBase);
            },
            parent === BASE_KEY,
          );
    const { pull, proposal } = head;
    nodes.set(head.key, {
      key: head.key,
      number: pull?.number ?? null,
      url: pull?.url ?? null,
      title: pull?.title ?? proposal?.title ?? head.branch,
      draft: pull?.draft ?? false,
      branch: head.branch,
      head: head.head,
      base: head.base,
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
      origins: originsOf(input, head),
    });
  }

  const chain = walkChain(
    [...nodes.values()].map((n) => ({
      key: n.key,
      parent: n.parent,
      stacked: n.stacked,
      off: n.off?.reason ?? null,
    })),
  );
  for (const n of nodes.values()) {
    n.onChain = !chain.off.has(n.key);
    n.off = chain.off.get(n.key) ?? null;
    n.fork = chain.forks.has(n.key);
  }
  const offChain = heads.map((h) => h.key).filter((k) => chain.off.has(k));
  const drawn = [...chain.order, ...offChain].map((k) => nodes.get(k)!);

  const placed = new Set(
    heads.flatMap((h) => (h.pull === null ? [] : [`${repoKey}#${h.pull.number}`])),
  );
  const byBranch = new Map(input.pulls.map((p) => [p.branch, p.number]));
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

  const allUnplaced = [...unplaced, ...branchUnplaced].sort((a, b) => a.number - b.number);
  addOffDetails(drawn, input.base.branch, input.proposals, allUnplaced);

  return {
    repo: input.repo,
    base: {
      branch: input.base.branch,
      head: input.base.head,
      fork: chain.forks.has(BASE_KEY),
    },
    origins: input.origins.map((o) => ({ name: o.name, repo: o.repo })),
    nodes: drawn,
    top: chain.top,
    tops: chain.tops,
    rows: smartlogRows(drawn, chain.top),
    ownRows: ownRows(drawn, chain.top),
    unplaced: allUnplaced,
    errors: input.errors,
    checkedAt: input.checkedAt,
    deployments: input.deployments.map((deployment) =>
      placeDeployment(deployment, layersOf(input.base.head, drawn), input.compare),
    ),
  };
}

/** The layers a deployment may sit on: the base branch (BASE_KEY) first, then every node in graph order. */
export function layersOf(baseHead: string | null, nodes: Array<{ key: string; head: string }>) {
  return [{ key: BASE_KEY, head: baseHead }, ...nodes.map((n) => ({ key: n.key, head: n.head }))];
}

/** Each origin's open PR on the node's branch, with its head against the node's. */
function originsOf(input: GraphInput, pull: GraphHead): ProposalGraphOriginPr[] {
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
