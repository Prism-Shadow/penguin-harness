/**
 * The four DISMISSIBLE badge trails, and what a dismissal is stamped against.
 *
 * `update-badges.ts` next door covers the one trail that clears itself — a software release —
 * where there is nothing to dismiss: the badge is gone the moment the update is installed.
 * These four are different in one way that decides the whole design: the user may reasonably
 * look at what is waiting and choose to leave it there. A model table deliberately kept off
 * the catalog, a Skill deliberately pinned to an older copy, an Agent deliberately left on the
 * defaults generation it was tuned against, an error already read and understood — none of
 * those should keep a red dot lit forever, and none of them changes any state a gate could
 * read. (The library is a plugin library now — a Skill pinned to an older copy reads as a
 * plugin pinned, and the trail is the plugins one; nothing else about the argument moved.)
 *
 * So each trail produces a **signature**: a string naming exactly WHAT is waiting. Dismissing
 * stores that string (`todo-dismissals.ts`); the badge is raised again only when what is
 * waiting has grown BEYOND it. Acting on the trail therefore clears the badge on its own (the
 * signature becomes null), and so does dismissing — but something *new* arriving raises it
 * again, which a plain "hidden forever" flag could not do.
 *
 * Containment, never equality: the user dismisses two plugin updates, installs one of them, and
 * the remaining one must stay dismissed — it is the thing they already waved away. What
 * "beyond" means differs by the shape of what is waiting, which is what {@link TodoMatch}
 * names.
 *
 * Pure decisions only (vitest runs node-only here, so nothing renders and nothing fetches);
 * `use-project-todos.ts` wires them to the live stores and turns a count into localized copy.
 */
import type { AgentSummary, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import type { CatalogDelta } from "../features/models/catalog-sync";

/** The four trails, in sidebar order. Also the key each dismissal is stored under. */
export type TodoKey = "agents" | "plugins" | "models" | "errors";

/**
 * How a dismissal is compared against what is waiting now.
 *
 * - `set` — the items are independent things (a plugin, a model reference). One of them absent
 *   from what was dismissed raises the badge; a smaller set never does.
 * - `watermark` — the signature is an ordered high-water mark (the newest error's timestamp),
 *   and only a HIGHER one raises the badge. Rows leave the window from either end — the row cap
 *   evicts the oldest, deleting an Agent removes its rows wherever they sit — so a signature
 *   that moved DOWN is not news.
 */
export type TodoMatch = "set" | "watermark";

/**
 * The two kinds of change a trail can be carrying, where it can tell them apart. Only the
 * Models trail can: the catalog is a list of entries, so an entry the table lacks is genuinely
 * NEW and one whose fields have moved is an upgrade, and `catalogDelta` already separates them
 * for the sync action itself. The other three cannot, and say so by leaving this absent rather
 * than reporting a zero — a plugin nobody has installed is not waiting for anyone, and an
 * Agent's kernel is never new, so "0 added" on those pages would be an answer to a question
 * that was never asked.
 */
export interface TodoBreakdown {
  /** Things the Project does not have at all yet. */
  added: number;
  /** Things it has an older form of. */
  updated: number;
}

/** What one trail has waiting. */
export interface Todo {
  /** What is waiting, as one string: {@link items} joined by `,`. This is what a dismissal stores. */
  signature: string;
  /**
   * The individual things waiting, one string each — what a stored signature is compared
   * against under {@link match}. Two runs that would show the user the same thing must produce
   * the same items, in the same order.
   */
  items: string[];
  /** How many things are waiting; the only number the copy names. */
  count: number;
  /** Which containment rule {@link raisedTodo} applies to this trail. */
  match: TodoMatch;
  /**
   * The added/upgradable split where the trail can honestly make one, absent where it cannot
   * (see {@link TodoBreakdown}). It always sums to {@link count}, so the page notice and the
   * nav dot cannot report different totals.
   */
  breakdown?: TodoBreakdown;
}

/**
 * Agents in this Project whose config is behind the current defaults generation. The flag rides
 * along on the Project's Agent list, so this costs no request of its own.
 *
 * **The signature is the set of outdated Agent ids, not id-plus-generation**, which makes this
 * the one trail whose dismissal is coarser than the others: a later defaults generation does
 * NOT raise the dot again for an Agent already waved away, the way a later plugin version or a
 * different catalog entry does. That is a deliberate limit rather than an oversight — the
 * generation stamp a signature would need (`KERNEL_VERSION`) lives in core's `state/`
 * alongside `node:crypto`, and pulling it into the browser bundle to sharpen a dismissal is a
 * bad trade. What makes the coarse form safe is that dismissing here silences only the page
 * notice and the nav dot: every outdated Agent keeps its own capsule on the list card and its
 * own update button in settings, so nothing the user waved away becomes unreachable. A NEW
 * Agent falling behind still raises it, which is the case a per-Project mute would lose.
 *
 * Counted by Agent, because that is what the page lists and what the update acts on one of.
 */
export function kernelUpdateTodo(
  agents: ReadonlyArray<Pick<AgentSummary, "agentId" | "kernelOutdated">>,
): Todo | null {
  const items = agents
    .filter((a) => a.kernelOutdated)
    .map((a) => a.agentId)
    .sort();
  if (items.length === 0) return null;
  return { signature: items.join(","), items, count: items.length, match: "set" };
}

/**
 * Library plugins some Agent in this Project has fallen behind on. The list rides along on the
 * Project's Agent list, so this costs no request of its own — the same trick `kernelOutdated`
 * plays for the kernel trail — and it is the SERVER's verdict: the web never compares versions
 * itself (they are `YYYY-MM-DD.N` strings, and only the library knows what it carries).
 *
 * Counted by distinct plugin, not per Agent: the trail ends on the plugin library page, which
 * lists the library once, so "3 plugins can be updated" is what the user will see there even if
 * the three are spread over five Agents. The signature carries the library VERSION alongside each
 * name, so a plugin dismissed at one version raises the badge again when the library moves on —
 * dismissing answers "not this update", not "never tell me about this plugin". Every Agent reads
 * the same library, so the version a name carries is the same wherever it appears; the first
 * occurrence is kept.
 */
export function pluginUpdateTodo(
  agents: ReadonlyArray<Pick<AgentSummary, "pluginUpdates">>,
): Todo | null {
  const latest = new Map<string, string>();
  for (const agent of agents) {
    for (const update of agent.pluginUpdates) {
      if (!latest.has(update.name)) latest.set(update.name, update.version);
    }
  }
  if (latest.size === 0) return null;
  const items = [...latest].map(([name, version]) => `${name}@${version}`).sort();
  return { signature: items.join(","), items, count: latest.size, match: "set" };
}

/**
 * Built-in catalog entries the Project's model table does not match. The delta is the sync
 * action's own (`catalog-sync.ts`), not a second opinion about it: a badge that leads to a
 * button which then reports "already up to date" is worse than no badge.
 *
 * The signature is the list of references that would change, so syncing part of the table by
 * hand and dismissing the rest behaves the way the user would expect, and a catalog release
 * touching a different model raises the badge again even when the count happens to match.
 *
 * The added/updated split is carried straight off the delta rather than recounted here, for the
 * same reason the count is: the notice on the page and the sync action behind its button have to
 * be describing one calculation, not two that agree today.
 */
export function presetUpdateTodo(delta: CatalogDelta): Todo | null {
  if (delta.refs.length === 0) return null;
  return {
    signature: delta.refs.join(","),
    items: [...delta.refs],
    count: delta.refs.length,
    match: "set",
    breakdown: { added: delta.added, updated: delta.updated },
  };
}

/**
 * Unexpected errors (500s and runtime exceptions) the cost center is holding. Expected errors
 * — an HttpError, a business 4xx — are deliberately not a to-do: they are the server saying no
 * on purpose, and there is nothing for the user to do about them.
 *
 * The page is the one-row probe `use-project-todos.ts` fetches, so `items[0]` is the newest
 * error and `total` the count in the window. The signature is that newest timestamp alone, and
 * it is a `watermark` rather than a set: the newest row can move DOWN as well as up — the row
 * cap evicts the oldest, and deleting an Agent takes its rows out from wherever they sit,
 * newest included — and a dot the user already cleared must not come back because rows left.
 */
export function unexpectedErrorTodo(page: UsageErrorsPage): Todo | null {
  const newest = page.items[0];
  if (newest === undefined || page.total === 0) return null;
  return { signature: newest.ts, items: [newest.ts], count: page.total, match: "watermark" };
}

/** The trail's badge: what is waiting, or null when nothing is or the user already waved this away. */
export function raisedTodo(todo: Todo | null, dismissed: string | null): Todo | null {
  if (todo === null) return null;
  if (dismissed === null) return todo;
  if (todo.match === "watermark") return todo.signature > dismissed ? todo : null;
  const seen = new Set(dismissed.split(","));
  return todo.items.some((item) => !seen.has(item)) ? todo : null;
}
