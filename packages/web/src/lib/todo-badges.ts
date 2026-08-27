/**
 * The three DISMISSIBLE badge trails, and what a dismissal is stamped against.
 *
 * `update-badges.ts` next door covers the two trails that clear themselves — a software
 * release and an Agent kernel — where there is nothing to dismiss: the badge is gone the
 * moment the update is installed. These three are different in one way that decides the
 * whole design: the user may reasonably look at what is waiting and choose to leave it
 * there. A model table deliberately kept off the catalog, a Skill deliberately pinned to an
 * older copy, an error already read and understood — none of those should keep a red dot lit
 * forever, and none of them changes any state a gate could read.
 *
 * So each trail produces a **signature**: a string naming exactly WHAT is waiting. Dismissing
 * stores that string (`todo-dismissals.ts`); the badge is raised again only when what is
 * waiting has grown BEYOND it. Acting on the trail therefore clears the badge on its own (the
 * signature becomes null), and so does dismissing — but something *new* arriving raises it
 * again, which a plain "hidden forever" flag could not do.
 *
 * Containment, never equality: the user dismisses two Skill updates, installs one of them, and
 * the remaining one must stay dismissed — it is the thing they already waved away. What
 * "beyond" means differs by the shape of what is waiting, which is what {@link TodoMatch}
 * names.
 *
 * Pure decisions only (vitest runs node-only here, so nothing renders and nothing fetches);
 * `use-project-todos.ts` wires them to the live stores and turns a count into localized copy.
 */
import type { AgentSummary, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import type { CatalogDelta } from "../features/models/catalog-sync";

/** The three trails, in sidebar order. Also the key each dismissal is stored under. */
export type TodoKey = "skills" | "models" | "errors";

/**
 * How a dismissal is compared against what is waiting now.
 *
 * - `set` — the items are independent things (a Skill, a model reference). One of them absent
 *   from what was dismissed raises the badge; a smaller set never does.
 * - `watermark` — the signature is an ordered high-water mark (the newest error's timestamp),
 *   and only a HIGHER one raises the badge. Rows leave the window from either end — the row cap
 *   evicts the oldest, deleting an Agent removes its rows wherever they sit — so a signature
 *   that moved DOWN is not news.
 */
export type TodoMatch = "set" | "watermark";

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
}

/**
 * Library Skills some Agent in this Project has fallen behind on. The flag rides along on the
 * Project's Agent list, so this costs no request of its own — the same trick `kernelOutdated`
 * plays for the kernel trail.
 *
 * Counted by distinct Skill, not per Agent: the trail ends on the Skills page, which lists the
 * library once, so "3 Skills can be updated" is what the user will see there even if the three
 * are spread over five Agents. The signature carries the library VERSION alongside each name,
 * so a Skill dismissed at v2 raises the badge again when the library reaches v3 — dismissing
 * answers "not this update", not "never tell me about this Skill".
 */
export function skillUpdateTodo(
  agents: ReadonlyArray<Pick<AgentSummary, "skillUpdates">>,
): Todo | null {
  const latest = new Map<string, number>();
  for (const agent of agents) {
    for (const update of agent.skillUpdates ?? []) {
      const known = latest.get(update.name);
      if (known === undefined || update.version > known) latest.set(update.name, update.version);
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
 */
export function presetUpdateTodo(delta: CatalogDelta): Todo | null {
  if (delta.refs.length === 0) return null;
  return {
    signature: delta.refs.join(","),
    items: [...delta.refs],
    count: delta.refs.length,
    match: "set",
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
