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
 * stores that string (`todo-dismissals.ts`); the badge is raised only while the current
 * signature differs from the stored one. Acting on the trail therefore clears the badge on
 * its own (the signature becomes null), and so does dismissing — but something *new* arriving
 * changes the signature and raises it again, which a plain "hidden forever" flag could not do.
 *
 * Pure decisions only (vitest runs node-only here, so nothing renders and nothing fetches);
 * `use-project-todos.ts` wires them to the live stores and turns a count into localized copy.
 */
import type { AgentSummary, UsageErrorsPage } from "@prismshadow/penguin-server/api";
import type { CatalogDelta } from "../features/models/catalog-sync";

/** The three trails, in sidebar order. Also the key each dismissal is stored under. */
export type TodoKey = "skills" | "models" | "errors";

/** What one trail has waiting. */
export interface Todo {
  /**
   * What is waiting, as a string. Two runs that would show the user the same thing must
   * produce the same signature, and any change to what is waiting must change it — that
   * equality IS the dismissal rule.
   */
  signature: string;
  /** How many things are waiting; the only number the copy names. */
  count: number;
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
  const signature = [...latest]
    .map(([name, version]) => `${name}@${version}`)
    .sort()
    .join(",");
  return { signature, count: latest.size };
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
  return { signature: delta.refs.join(","), count: delta.refs.length };
}

/**
 * Unexpected errors (500s and runtime exceptions) the cost center is holding. Expected errors
 * — an HttpError, a business 4xx — are deliberately not a to-do: they are the server saying no
 * on purpose, and there is nothing for the user to do about them.
 *
 * The page is the one-row probe `use-project-todos.ts` fetches, so `items[0]` is the newest
 * error and `total` the count in the window. The signature is that newest timestamp alone:
 * rows are only ever evicted oldest-first, so the newest changes exactly when a newer error
 * arrives — which is precisely when a dot the user already cleared should come back.
 */
export function unexpectedErrorTodo(page: UsageErrorsPage): Todo | null {
  const newest = page.items[0];
  if (newest === undefined || page.total === 0) return null;
  return { signature: newest.ts, count: page.total };
}

/** The trail's badge: what is waiting, or null when nothing is or the user has dismissed exactly this. */
export function raisedTodo(todo: Todo | null, dismissed: string | null): Todo | null {
  if (todo === null || todo.signature === dismissed) return null;
  return todo;
}
