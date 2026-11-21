/**
 * Why each cookie an import found stayed behind: every skip is counted under exactly one
 * reason, so the reasons always add up to the number skipped. Reported in a fixed order — what
 * the user can act on first (app-bound, then a key the platform kept), what is expected last
 * (partitioned, expired) — whatever order the rows came in.
 */
import type { BuiltinBrowserCookieSkip, BuiltinBrowserCookieSkipReason } from "../../api/types.js";

const ORDER: readonly BuiltinBrowserCookieSkipReason[] = [
  "app_bound",
  "dpapi",
  "keychain",
  "keyring",
  "undecryptable",
  "partitioned",
  "expired",
];

export class SkipTally {
  private readonly counts = new Map<BuiltinBrowserCookieSkipReason, number>();

  add(reason: BuiltinBrowserCookieSkipReason): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }

  /** The reasons that occurred, with their counts. */
  list(): BuiltinBrowserCookieSkip[] {
    return ORDER.flatMap((reason) => {
      const count = this.counts.get(reason) ?? 0;
      return count > 0 ? [{ reason, count }] : [];
    });
  }
}

/** The number of cookies a list of skips accounts for. */
export function skippedCount(skips: readonly BuiltinBrowserCookieSkip[]): number {
  return skips.reduce((sum, skip) => sum + skip.count, 0);
}
