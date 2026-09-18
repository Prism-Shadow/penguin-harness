/**
 * Pure rules of the details card's background-process list (chat-page.tsx): which entries
 * the list's "clear exited" action removes, and which failure out of a batch of per-entry
 * requests is worth telling the user about. Kept out of the page so they are unit-testable
 * (vitest runs node-only, no DOM).
 */
import type { SessionProcessInfo } from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";

/**
 * The entries "clear exited" removes, in list order: every row that is no longer running.
 * A running row is never among them — stopping one is its own Stop button's job, and the
 * server refuses to remove a live entry anyway.
 */
export function exitedProcessIds(
  processes: readonly Pick<SessionProcessInfo, "processId" | "running">[],
): string[] {
  return processes.filter((p) => !p.running).map((p) => p.processId);
}

/**
 * The one failure worth a toast out of a batch of per-entry requests (a row's own Stop or
 * Remove is a batch of one): the first rejection whose status is not in `staleStatuses`.
 * Those only mean the list was stale — an entry already gone, or one that turned out to be
 * running — and the refresh that follows every action already shows the truth. One toast
 * for the batch rather than one per entry, because what fails one request of a batch (a
 * lost login, an unreachable server) fails the rest the same way. Null when nothing else
 * failed.
 */
export function reportableProcessFailure(
  results: readonly PromiseSettledResult<unknown>[],
  staleStatuses: readonly number[],
): { error: unknown } | null {
  for (const result of results) {
    if (result.status !== "rejected") continue;
    const error: unknown = result.reason;
    if (error instanceof ApiError && staleStatuses.includes(error.status)) continue;
    return { error };
  }
  return null;
}
