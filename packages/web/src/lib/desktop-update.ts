/**
 * Client-update row logic for the sidebar user menu (desktop shell only).
 *
 * The row's data is the shell's updater snapshot; use-desktop-update.ts owns the
 * polling, the armed-check watch and the toasts, these helpers keep the mapping pure
 * (vitest runs node-only here, so nothing renders — same split as account-menu.ts).
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

/** The row's render mode; action and busy derive from it (ROW_BEHAVIOR), so they cannot disagree. */
export type ClientUpdateLabelKind =
  | "check"
  | "checking"
  | "downloading"
  | "install"
  | "unsupported"
  /** No snapshot yet (the shell wires its port a beat after boot): render disabled until one lands. */
  | "unknown";

const ROW_BEHAVIOR: Record<
  ClientUpdateLabelKind,
  { action: "check" | "install" | "none"; busy: boolean }
> = {
  check: { action: "check", busy: false },
  checking: { action: "none", busy: true },
  downloading: { action: "none", busy: true },
  install: { action: "install", busy: false },
  unsupported: { action: "none", busy: false },
  unknown: { action: "none", busy: false },
};

/** What the row renders for one snapshot. */
export interface ClientUpdateRowModel {
  labelKind: ClientUpdateLabelKind;
  /** What a click does; `none` renders the row disabled. Derived from labelKind. */
  action: "check" | "install" | "none";
  /** Spinner + no click while the shell is checking or downloading. Derived from labelKind. */
  busy: boolean;
  /** Newer release the label names (`downloading`, `install`). */
  version: string | null;
  /** Download progress 0–100, when the shell reported one. */
  percent: number | null;
  /** Installed client version for the right-aligned chip; null until the first push. */
  appVersion: string | null;
  /** Why updates are off (`unsupported` label's tooltip). */
  unsupportedReason: "dev" | "linux-not-appimage" | null;
}

function rowOf(
  labelKind: ClientUpdateLabelKind,
  status: DesktopUpdateStatus | null,
  rest: Partial<Pick<ClientUpdateRowModel, "version" | "percent" | "unsupportedReason">> = {},
): ClientUpdateRowModel {
  return {
    labelKind,
    ...ROW_BEHAVIOR[labelKind],
    version: null,
    percent: null,
    appVersion: status?.appVersion ?? null,
    unsupportedReason: null,
    ...rest,
  };
}

/**
 * Maps one snapshot to the row. `checkPending` is the gap between clicking the check
 * and the shell's `checking` frame landing: the row already spins, so a second click
 * cannot arm a second watch.
 */
export function clientUpdateRow(
  status: DesktopUpdateStatus | null,
  checkPending = false,
): ClientUpdateRowModel {
  if (status === null) return rowOf("unknown", status);
  switch (status.state) {
    case "unsupported":
      return rowOf("unsupported", status, { unsupportedReason: status.reason ?? null });
    case "checking":
      return rowOf("checking", status);
    case "downloading":
      return rowOf("downloading", status, {
        version: status.version ?? null,
        percent: status.percent ?? null,
      });
    case "downloaded":
      return rowOf("install", status, { version: status.version ?? null });
    // idle / up-to-date / error all offer the (re-)check; error details reach the user
    // through the settle toast of the check that produced them, not a persistent row.
    default:
      return checkPending ? rowOf("checking", status) : rowOf("check", status);
  }
}

/** How one row-initiated check ended, for exactly one toast per outcome (the same rule as the server-update row's manual check). */
export type ClientCheckSettle =
  | { kind: "up-to-date" }
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
