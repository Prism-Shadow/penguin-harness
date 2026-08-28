/**
 * Updater status tracking (pure; no Electron import, so it unit-tests directly).
 *
 * updater.ts folds electron-updater's events through `nextUpdateStatus` and pushes each
 * snapshot to the embedded server (main.ts wires the utilityProcess port), where
 * GET /api/desktop/update serves it to the shell window's update modal and account-menu
 * row. The wire shapes are the server's api contract (DesktopUpdateStatus / the two
 * message types), imported type-only so nothing of the server bundles into the shell.
 *
 * A check ends in `available` — the release is offered, nothing is fetched. The download
 * begins only on the user's say-so (`download-started`, from the page's download command
 * or the native dialog), and runs `downloading` → `downloaded`.
 *
 * Three deliberate suppression rules keep the headline truthful:
 *
 * - A `downloaded` build outranks transient noise — `checking`, `not-available`,
 *   `error`, a re-announce of the same version. Once a release sits on disk, "restart
 *   to install" must not flicker away under a periodic re-check or its network
 *   failure. What it does yield to: a **different** version being fetched
 *   (`available`/`download-started`/`downloaded` with another version —
 *   electron-updater invalidates the held package the moment a replacement download
 *   starts, so keeping the old headline would point the install button at a deleted file).
 * - While `downloading`, a concurrent check's `checking` (and a same-version
 *   re-announce) is suppressed: folding it would drop the download context and every
 *   later progress tick with it. A download's own failure still lands as `error`.
 * - While `available`, a check's `checking` and a same-version re-announce are suppressed
 *   too: the offer must not blink out under the fallback-feed re-check that a failed
 *   download runs. A different version, an up-to-date answer, or an error replace it.
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
  /** The user accepted the offer: updater.ts is about to call downloadUpdate(). */
  | { kind: "download-started"; version: string }
  | { kind: "progress"; percent: number }
  | { kind: "downloaded"; version: string }
  | { kind: "error"; message: string };

/** Before any event: the app is simply running its installed version. */
export function initialUpdateStatus(appVersion: string): DesktopUpdateStatus {
  return { appVersion, state: "idle" };
}

/** Folds one updater event into the snapshot (see the module comment for the suppression rules). */
export function nextUpdateStatus(prev: DesktopUpdateStatus, ev: UpdaterEvent): DesktopUpdateStatus {
  const { appVersion } = prev;
  if (prev.state === "downloaded") {
    const replacement =
      (ev.kind === "available" || ev.kind === "download-started" || ev.kind === "downloaded") &&
      ev.version !== prev.version;
    if (!replacement && ev.kind !== "unsupported") return prev;
  }
  if (prev.state === "downloading") {
    if (ev.kind === "checking" || ev.kind === "not-available") return prev;
    if (
      (ev.kind === "available" || ev.kind === "download-started") &&
      ev.version === prev.version
    ) {
      return prev;
    }
  }
  if (prev.state === "available") {
    if (ev.kind === "checking") return prev;
    if (ev.kind === "available" && ev.version === prev.version) return prev;
  }
  switch (ev.kind) {
    case "unsupported":
      return { appVersion, state: "unsupported", reason: ev.reason };
    case "checking":
      return { appVersion, state: "checking" };
    case "not-available":
      return { appVersion, state: "up-to-date" };
    case "available":
      return { appVersion, state: "available", version: ev.version };
    case "download-started":
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
  return msg.action === "check" || msg.action === "download" || msg.action === "install"
    ? msg.action
    : null;
}
