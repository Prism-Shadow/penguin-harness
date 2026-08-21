/**
 * Updater status tracking (pure; no Electron import, so it unit-tests directly).
 *
 * updater.ts folds electron-updater's events through `nextUpdateStatus` and pushes each
 * snapshot to the embedded server (main.ts wires the utilityProcess port), where
 * GET /api/desktop/update serves it to the shell window's account menu. The wire shapes
 * are the server's api contract (DesktopUpdateStatus / the two message types), imported
 * type-only so nothing of the server bundles into the shell.
 *
 * One deliberate rule: a `downloaded` build outranks every later event except an
 * install. Once a release is sitting on disk, "restart to install" is the only truthful
 * headline — a periodic re-check (or its network failure) flashing "checking…" or
 * "error" over it would hide the actionable step the user was told to expect.
 */
import type {
  DesktopUpdateStatus,
  DesktopUpdaterCommandMessage,
  DesktopUpdaterStatusMessage,
} from "@prismshadow/penguin-server/api";

/** electron-updater's events, reduced to what the status needs. */
export type UpdaterEvent =
  | { kind: "unsupported"; reason: "dev" | "linux-not-appimage" }
  | { kind: "checking" }
  | { kind: "not-available" }
  | { kind: "available"; version: string }
  | { kind: "progress"; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

/** Before any event: the app is simply running its installed version. */
export function initialUpdateStatus(appVersion: string): DesktopUpdateStatus {
  return { appVersion, state: "idle" };
}

/** Folds one updater event into the snapshot (see the module comment for the `downloaded` rule). */
export function nextUpdateStatus(prev: DesktopUpdateStatus, ev: UpdaterEvent): DesktopUpdateStatus {
  const { appVersion } = prev;
  if (prev.state === "downloaded" && ev.kind !== "downloaded" && ev.kind !== "unsupported") {
    return prev;
  }
  switch (ev.kind) {
    case "unsupported":
      return { appVersion, state: "unsupported", reason: ev.reason };
    case "checking":
      return { appVersion, state: "checking" };
    case "not-available":
      return { appVersion, state: "up-to-date" };
    case "available":
      return { appVersion, state: "downloading", version: ev.version, percent: 0 };
    case "progress":
      // A progress tick outside a download (stale timer) must not fabricate one.
      return prev.state === "downloading"
        ? { appVersion, state: "downloading", version: prev.version, percent: ev.percent }
        : prev;
    case "downloaded":
      return { appVersion, state: "downloaded", version: ev.version };
    case "error":
      return { appVersion, state: "error", message: ev.message };
  }
}

/** Wraps a snapshot for the port push. */
export function updaterStatusMessage(status: DesktopUpdateStatus): DesktopUpdaterStatusMessage {
  return { type: "desktop-updater-status", status };
}

/** Validates one server-relayed command frame off the port. */
export function parseUpdaterCommand(data: unknown): DesktopUpdaterCommandMessage["action"] | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as Partial<DesktopUpdaterCommandMessage>;
  if (msg.type !== "desktop-updater-command") return null;
  return msg.action === "check" || msg.action === "install" ? msg.action : null;
}
