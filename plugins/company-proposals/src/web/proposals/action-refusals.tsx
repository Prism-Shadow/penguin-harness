/**
 * Why an action button is disabled when a guard said no: the refusal the actions listing
 * (`GET …/actions?subject=`) carries for each Action the caller may not run now, shown under the
 * action bar and tied to its button as the button's accessible description.
 *
 * Shown as a line rather than a hover hint: the app's tooltip layer gives no hint to a button
 * whose label is already readable (tooltip.tsx), and a disabled button takes no hover anyway.
 */
import type { ActionView } from "@prismshadow/penguin-server/api";

/** A guard's refusal of one Action, as the listing gives it. */
export type Refusal = NonNullable<ActionView["refusal"]>;

/** The guards' answers on a subject: the keys allowed, and why each refused one is not. */
export interface ActionAnswers {
  allowed: ReadonlySet<string>;
  refusals: ReadonlyMap<string, Refusal>;
}

/** The answers in a listing: an Action not asked about (no `allowed`) is neither. */
export function actionAnswers(actions: readonly ActionView[]): ActionAnswers {
  const allowed = new Set<string>();
  const refusals = new Map<string, Refusal>();
  for (const a of actions) {
    if (a.allowed === true) allowed.add(a.key);
    else if (a.allowed === false && a.refusal !== undefined) refusals.set(a.key, a.refusal);
  }
  return { allowed, refusals };
}

/** A refusal in words: the guard's message, then its code. */
export function refusalText(r: Refusal): string {
  return r.message.trim() === "" ? r.code : `${r.message} (${r.code})`;
}

/** The id of the note describing the button of `key`. */
export const refusalNoteId = (scope: string, key: string): string =>
  `${scope}-refusal-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** One disabled button's reason: its label, and the refusal. */
export interface RefusalNote {
  key: string;
  label: string;
  refusal: Refusal;
}

/** The reasons under the action bar, one line each; nothing when no button is refused. */
export function RefusalNotes({ scope, notes }: { scope: string; notes: readonly RefusalNote[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="basis-full space-y-1 text-right text-xs text-gray-500 dark:text-gray-400">
      {notes.map((n) => (
        <li key={n.key} id={refusalNoteId(scope, n.key)}>
          <span className="font-medium">{n.label}</span>: {refusalText(n.refusal)}
        </li>
      ))}
    </ul>
  );
}
