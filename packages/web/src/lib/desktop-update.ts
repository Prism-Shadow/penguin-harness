/**
 * Client-update helpers for the desktop shell's own window: whether the client update
 * surface is offered at all, and when an armed row-initiated check has settled.
 * use-desktop-update.ts owns the polling and the armed watch; these keep the decisions
 * pure (vitest runs node-only here, so nothing renders — same split as account-menu.ts).
 */
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import type { AccountMenuSession } from "./account-menu";

/**
 * Whether to offer the client-update row at all: only the shell's own window. Both
 * halves matter, mirroring offersChangePassword's reasoning inverted — `desktopMode`
 * alone would let a browser signed into the same desktop-mode server read this
 * machine's updater state and restart its GUI app; `sessionVia` alone would offer the
 * row to a stale desktop cookie replayed against a plain `penguin server`, where no
 * shell is listening. The server enforces the same pair on the routes.
 */
export function offersClientUpdate(session: AccountMenuSession): boolean {
  return session.desktopMode && session.sessionVia === "desktop";
}

/** How one row-initiated check ended, for exactly one report per outcome (in the modal when it is open, a toast otherwise). */
export type ClientCheckSettle =
  | { kind: "up-to-date" }
  /** The check offered a release (`available`), or ran into one already being fetched. */
  | { kind: "found"; version: string | null }
  /** The check ran into a build already sitting on disk: point at the install step, not at a download. */
  | { kind: "ready"; version: string | null }
  | { kind: "unsupported"; reason: "dev" | "linux-not-appimage" | null }
  /**
   * `message` is the shell's own failure text when there is one — an updater error is
   * not always a failed check (a download that fails its sha512 or, on Windows, its
   * Authenticode publisher check lands here too), so the generic "check failed" wording
   * is only correct for the case with nothing to report: the watch timing out.
   */
  | { kind: "failed"; message: string | null };

/** An armed check that saw no outcome for this long settles as failed (shell gone, frame lost). */
export const CLIENT_CHECK_TIMEOUT_MS = 60_000;

/**
 * Decides whether an armed check has settled, given the snapshot seq at click time,
 * the latest snapshot and the time since the click. The shell bumps `seq` on every
 * event it folds — snapshot equality cannot carry the signal, since a check that ends
 * where it started (still up to date) is byte-identical. A concurrent automatic check
 * moving the seq settles the watch too; its outcome is a real, just-completed check,
 * so reporting it answers the user truthfully. Without a seq on either side the
 * fallback settles on any terminal state once two poll rounds have passed. Returns
 * null while still in flight.
 */
export function clientCheckSettle(
  atClickSeq: number | null,
  now: DesktopUpdateStatus | null,
  elapsedMs: number,
): ClientCheckSettle | null {
  const timedOut = elapsedMs >= CLIENT_CHECK_TIMEOUT_MS;
  if (now === null) return timedOut ? { kind: "failed", message: null } : null;
  if (now.state === "checking") return null; // visibly in flight — the row spins
  const moved =
    now.seq !== undefined && atClickSeq !== null ? now.seq !== atClickSeq : elapsedMs >= 4_000;
  if (!moved) return timedOut ? { kind: "failed", message: null } : null;
  switch (now.state) {
    case "up-to-date":
      return { kind: "up-to-date" };
    case "available":
    case "downloading":
      return { kind: "found", version: now.version ?? null };
    case "downloaded":
      return { kind: "ready", version: now.version ?? null };
    case "unsupported":
      return { kind: "unsupported", reason: now.reason ?? null };
    case "error":
      return { kind: "failed", message: now.message ?? null };
    // idle: the seq moved but no check began (shouldn't happen); only the timeout ends it.
    default:
      return timedOut ? { kind: "failed", message: null } : null;
  }
}
