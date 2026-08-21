/**
 * Client-update row logic for the sidebar user menu (desktop shell only).
 *
 * The row's data is the shell's updater snapshot, polled from GET /api/desktop/update
 * while the menu is open; these helpers keep the mapping pure (vitest runs node-only
 * here, so nothing renders — same split as account-menu.ts). The component in
 * components/account/desktop-update-row.tsx owns the polling and the toasts.
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

/** What the row renders for one snapshot (`status` null = the shell has not pushed yet). */
export interface ClientUpdateRowModel {
  /** What a click does; `none` renders the row disabled. */
  action: "check" | "install" | "none";
  /** Spinner + no click while the shell is checking or downloading. */
  busy: boolean;
  labelKind: "check" | "checking" | "downloading" | "install" | "unsupported";
  /** Newer release the label names (`downloading`, `install`). */
  version: string | null;
  /** Download progress 0–100, when the shell reported one. */
  percent: number | null;
  /** Installed client version for the right-aligned chip; null until the first push. */
  appVersion: string | null;
  /** Why updates are off (`unsupported` label's tooltip). */
  unsupportedReason: "dev" | "linux-not-appimage" | null;
}

export function clientUpdateRow(status: DesktopUpdateStatus | null): ClientUpdateRowModel {
  const base = {
    version: null,
    percent: null,
    appVersion: status !== null && status.appVersion !== "" ? status.appVersion : null,
    unsupportedReason: null,
  };
  // No push yet: offer the check anyway — the POST either lands once the shell wires
  // the port (a beat after boot) or answers 503, which the row surfaces as a failure.
  if (status === null) return { ...base, action: "check", busy: false, labelKind: "check" };
  switch (status.state) {
    case "unsupported":
      return {
        ...base,
        action: "none",
        busy: false,
        labelKind: "unsupported",
        unsupportedReason: status.reason ?? null,
      };
    case "checking":
      return { ...base, action: "none", busy: true, labelKind: "checking" };
    case "downloading":
      return {
        ...base,
        action: "none",
        busy: true,
        labelKind: "downloading",
        version: status.version ?? null,
        percent: status.percent ?? null,
      };
    case "downloaded":
      return {
        ...base,
        action: "install",
        busy: false,
        labelKind: "install",
        version: status.version ?? null,
      };
    // idle / up-to-date / error all offer the (re-)check; error details reach the user
    // through the settle toast of the check that produced them, not a persistent row.
    default:
      return { ...base, action: "check", busy: false, labelKind: "check" };
  }
}

/** How one row-initiated check ended, for exactly one toast per outcome (the same rule as the server-update row's manual check). */
export type ClientCheckSettle =
  { kind: "up-to-date" } | { kind: "found"; version: string | null } | { kind: "failed" };

/**
 * Decides whether a click's check has settled, given the snapshot at click time, the
 * latest poll, and whether any `checking` frame was seen since. The pair comparison
 * covers the common path (the terminal snapshot differs from the stale one); the
 * `sawChecking` escape hatch covers a check whose terminal state equals the
 * pre-click one byte for byte (up to date → still up to date) with the intermediate
 * frame caught by a poll in between. Returns null while still in flight.
 */
export function clientCheckSettle(
  atClick: DesktopUpdateStatus | null,
  now: DesktopUpdateStatus | null,
  sawChecking: boolean,
): ClientCheckSettle | null {
  if (now === null || now.state === "checking") return null;
  const changed = JSON.stringify(atClick) !== JSON.stringify(now);
  if (!changed && !sawChecking) return null;
  switch (now.state) {
    case "up-to-date":
      return { kind: "up-to-date" };
    case "downloading":
    case "downloaded":
      return { kind: "found", version: now.version ?? null };
    case "error":
      return { kind: "failed" };
    default:
      return null;
  }
}
