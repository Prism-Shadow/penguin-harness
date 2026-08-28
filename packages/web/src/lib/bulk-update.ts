/**
 * The decisions behind the page notice's "update everything on this tab" button: what the
 * notice claims is waiting, and what the user is told afterwards when only some of it landed.
 *
 * Kept pure and apart from the pages for the reason `todo-badges.ts` is: vitest runs node-only
 * here, so a rule that lives in a component is a rule nothing checks. The pages own the
 * requests; everything that decides what a number MEANS is here.
 */
import type { Todo } from "./todo-badges";

/**
 * The two numbers a notice may state. `added` is absent on the trails that cannot honestly
 * report one — see {@link Todo.breakdown}; the notice then names the upgradable count alone
 * rather than padding the sentence with a zero.
 */
export interface NoticeCounts {
  added: number | null;
  updated: number;
}

/**
 * What the notice says is waiting, read off the SAME raised to-do that lit the nav dot. Going
 * back to the underlying data for a second opinion is the one thing this must not do: a block
 * claiming three updates under a dot raised for four is a bug the user cannot resolve, and it is
 * exactly what two independent counts drift into.
 *
 * A trail with no breakdown reports its whole count as upgradable, which is what it is: a Skill
 * some Agent has fallen behind on and an Agent behind the defaults generation are both things
 * the Project already has an older form of.
 */
export function noticeCounts(todo: Todo): NoticeCounts {
  if (todo.breakdown === undefined) return { added: null, updated: todo.count };
  return { added: todo.breakdown.added, updated: todo.breakdown.updated };
}

/** How a bulk write went, in the terms the toast reports it in. */
export interface BulkOutcome {
  /** Everything landed. */
  allOk: boolean;
  /** How many targets were written successfully. */
  ok: number;
  /** The labels that failed, in the order they were attempted; empty when none did. */
  failed: string[];
}

/**
 * Zips a settled batch back onto the labels it was launched from, so a partial failure can name
 * WHICH targets are still behind.
 *
 * `Promise.allSettled` preserves input order, which is what makes the pairing sound — and the
 * reason the labels are passed in rather than recovered from the results, which carry no
 * identity of their own. Reporting only the first error (the precedent this replaces) leaves
 * the user knowing that something failed and not what: on a page whose whole point is acting on
 * everything at once, "3 of 5 updated" without the missing two is an unfinished sentence.
 */
export function bulkOutcome(
  labels: readonly string[],
  results: readonly PromiseSettledResult<unknown>[],
): BulkOutcome {
  const failed: string[] = [];
  let ok = 0;
  results.forEach((result, i) => {
    if (result.status === "fulfilled") ok += 1;
    // A label the caller did not supply for this index would be a programming error, not a
    // user-facing one; falling back to the index keeps the toast honest instead of blank.
    else failed.push(labels[i] ?? String(i));
  });
  return { allOk: failed.length === 0, ok, failed };
}

/**
 * How many failed targets the toast names before it stops listing.
 *
 * Naming them is the point of the partial-failure report, but a batch of twenty turns a
 * six-second toast into a wall of text nobody finishes reading. The overflow is reported as a
 * count rather than dropped silently: the reader still knows the list is not the whole of it.
 */
const MAX_NAMED_FAILURES = 8;

/** The failed labels as one string, capped. `+N` stands for the ones past the cap. */
export function failedList(failed: readonly string[], separator: string): string {
  if (failed.length <= MAX_NAMED_FAILURES) return failed.join(separator);
  const named = failed.slice(0, MAX_NAMED_FAILURES).join(separator);
  return `${named}${separator}+${failed.length - MAX_NAMED_FAILURES}`;
}

/** The first rejection's reason, for the error text appended to a partial-failure report. */
export function firstFailure(results: readonly PromiseSettledResult<unknown>[]): unknown {
  const rejected = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  return rejected?.reason;
}
