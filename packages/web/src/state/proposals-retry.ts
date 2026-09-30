/**
 * The backoff behind a failed read of the open organization's proposals (state/company.tsx,
 * `reloadProposals`). That list is what every roadmap row's status pill and every
 * `proposal:<n>` capsule read, and it is otherwise read once per organization entry: the event
 * that would read it again is the proposals plugin's, which a dropped link to the machine the
 * organization runs on stops delivering. So a failure is read again on its own, waiting
 * `PROPOSALS_RETRY_MIN_MS` and doubling up to `PROPOSALS_RETRY_MAX_MS` — the sessions list's
 * reload shape (state/sessions.tsx), kept separate because the two back off different reads.
 */

export const PROPOSALS_RETRY_MIN_MS = 2_000;
export const PROPOSALS_RETRY_MAX_MS = 30_000;

export interface ProposalsRetry {
  /** A read of `key` starts: a retry still waiting gives way to it; another organization starts the count afresh. */
  starting: (key: string) => void;
  /** The read answered: the next failure waits the shortest time again. */
  answered: () => void;
  /** The read of `key` failed: `again` runs after the next wait, unless a read of it is already waiting. */
  failed: (key: string, again: () => void) => void;
}

export function createProposalsRetry(): ProposalsRetry {
  let pending: ReturnType<typeof setTimeout> | null = null;
  /** The organization the failures are counted for. */
  let key: string | null = null;
  /** Failures in a row: the exponent of the next wait. */
  let failures = 0;
  return {
    starting: (next) => {
      if (pending !== null) clearTimeout(pending);
      pending = null;
      if (next === key) return;
      key = next;
      failures = 0;
    },
    answered: () => {
      failures = 0;
    },
    failed: (of, again) => {
      // A newer read of the same organization may have failed (and scheduled) meanwhile.
      if (pending !== null || of !== key) return;
      const delay = Math.min(PROPOSALS_RETRY_MAX_MS, PROPOSALS_RETRY_MIN_MS * 2 ** failures);
      failures += 1;
      const timer = setTimeout(() => {
        if (pending !== timer) return;
        pending = null;
        again();
      }, delay);
      pending = timer;
    },
  };
}
