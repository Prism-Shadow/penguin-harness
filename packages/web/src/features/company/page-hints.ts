/**
 * The dismissal of a page hint: the one-line muted note an empty calendar or an empty ticket
 * board shows above its grid, saying what the page is for and where its create button is. The
 * note is read once and then in the way forever, so the "×" beside it puts it away for good —
 * the same sentence stays in the page's "?", which is where it is reachable afterwards.
 *
 * Scoped by user, Project, organization and page: two people on one browser dismiss
 * separately, and a note dismissed in one organization still greets the first empty board of
 * the next — the organization it explains is the one the reader has not seen yet.
 *
 * Storage is injectable (org-draft.ts convention: vitest runs in Node with no localStorage)
 * and every read degrades to "not dismissed": showing a one-line note once too often costs
 * far less than throwing while a page renders.
 */

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory one. */
export interface HintStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The pages that carry a dismissible hint. */
export type HintPage = "calendar" | "tickets";

/** What a dismissed hint stores. The value is never read back — the key's presence is the answer. */
const DISMISSED = "1";

/** The hint's storage key. One key per (user, Project, organization, page); a signed-out browser gets its own bucket. */
export function hintKey(
  userId: string | null,
  projectId: string,
  orgId: string,
  page: HintPage,
): string {
  return `penguin.orgPageHint.${userId ?? ""}.${projectId}.${orgId}.${page}`;
}

/** Whether this hint has been dismissed. Anything unreadable (private browsing, a cleared bucket) reads as "no". */
export function isHintDismissed(key: string, storage?: HintStorage): boolean {
  try {
    return (storage ?? localStorage).getItem(key) !== null;
  } catch {
    return false;
  }
}

/** Puts the hint away for good. A storage that refuses the write costs the click nothing beyond this render. */
export function dismissHint(key: string, storage?: HintStorage): void {
  try {
    (storage ?? localStorage).setItem(key, DISMISSED);
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}
