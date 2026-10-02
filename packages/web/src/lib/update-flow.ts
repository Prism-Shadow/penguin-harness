/**
 * The software-update flow: one state machine over two backends, rendered by the App info
 * dialog's update section, the account-menu row and the version-line badge.
 *
 * `release` mode is every ordinary server: the newer release comes from the server's
 * GitHub lookup (`use-version-info.ts`), the download is the admin self-update job
 * (`penguin update` in the background, `GET/POST /api/version/update`) and the restart is
 * `POST /api/version/restart`, honored when `penguin server|web` supervises the process.
 * `client` mode is the desktop shell's own window: the shell's updater snapshot
 * (`use-desktop-update.ts`) carries every step, and the page only relays check / download
 * / install. `none` is a browser signed into a desktop-mode server, which can act on
 * neither: its App info dialog has no update section and its row announces nothing.
 *
 * The flow itself is what both surfaces agree on: nothing is fetched until the user
 * confirms, a running download keeps going when the dialog closes and keeps reporting through
 * the row, and a downloaded (or installed) release waits for an explicit restart. Pure
 * decisions only (vitest runs node-only here, so nothing renders) — `use-update-flow.ts`
 * feeds these from the live stores and owns the actions.
 */
import type {
  DesktopUpdateStatus,
  UpdateCheckResponse,
  UpdateJobPhase,
  UpdateJobStatus,
  VersionResponse,
} from "@prismshadow/penguin-server/api";
import type { AccountMenuSession } from "./account-menu";
import { offersClientUpdate } from "./desktop-update";
import { updateCheckOutcome } from "./use-version-info";

export type UpdateMode = "release" | "client" | "none";

/** Which backend this session updates through (see the module comment). */
export function updateModeFor(session: AccountMenuSession): UpdateMode {
  if (offersClientUpdate(session)) return "client";
  return session.desktopMode ? "none" : "release";
}

/** Why this install cannot update itself, as the backend reported it. */
export type UpdateUnsupported =
  | { code: "dev" }
  | { code: "linux-not-appimage" }
  | { code: "not_launched_via_cli" }
  /** The CLI declined (source checkout, unrecognized layout, Windows); `detail` is its own message. */
  | { code: "cli_refused"; detail: string };

export type UpdateFlow =
  /** No check has answered yet. */
  | { kind: "unknown" }
  | { kind: "checking" }
  /** Checks are turned off (PENGUIN_UPDATE_CHECK=off); the Releases page is the only way to look. */
  | { kind: "disabled" }
  | { kind: "up-to-date"; version: string | null }
  /** A newer release is offered; nothing has been fetched. `canInstall` is false for a non-admin on a server. */
  | { kind: "available"; version: string; releaseUrl: string | null; canInstall: boolean }
  /** `percent` null = indeterminate; `phase` is the server job's stage (client downloads have none). */
  | {
      kind: "downloading";
      version: string | null;
      percent: number | null;
      phase: UpdateJobPhase | null;
    }
  /** Downloaded (client) or installed (release): a restart runs it. `manual` = nothing can restart this process; the user does it by hand. */
  | { kind: "ready"; version: string | null; restart: "auto" | "manual" }
  | { kind: "restarting"; version: string | null }
  /** `detail` is the backend's own text (the update command's output tail); `retry` names the step that failed. */
  | { kind: "error"; message: string | null; detail: string | null; retry: "check" | "download" }
  | { kind: "unsupported"; reason: UpdateUnsupported };

/** What the page itself has in flight, beside the backend snapshots. */
export interface FlowLocal {
  /** A manual check was asked for and has not answered. */
  checking: boolean;
  /** The download request is on the wire — the backend has not yet reported the download. */
  downloadRequested: boolean;
  /** The restart step: asked for (waiting for the process to come back / the window to close), or refused because nothing supervises the process. */
  restart: "none" | "requested" | "manual";
}

export const NO_LOCAL: FlowLocal = { checking: false, downloadRequested: false, restart: "none" };

/** The Releases page of one version — the client mode's release-notes link (the shell names a version, never a URL). */
export function releaseUrlFor(version: string): string {
  return `https://github.com/Prism-Shadow/penguin-harness/releases/tag/v${version}`;
}

export interface ReleaseInputs {
  version: VersionResponse | null;
  update: UpdateCheckResponse | null;
  job: UpdateJobStatus | null;
  isAdmin: boolean;
}

/** The flow of an ordinary server (see the module comment); the job outranks the check, the restart outranks both. */
export function releaseFlow(i: ReleaseInputs, local: FlowLocal): UpdateFlow {
  const offered = i.update?.updateAvailable === true ? (i.update.latestVersion ?? null) : null;
  if (local.restart === "requested") {
    return { kind: "restarting", version: i.job?.targetVersion ?? offered };
  }
  if (i.job?.state === "running") {
    return {
      kind: "downloading",
      version: i.job.targetVersion,
      percent: i.job.percent ?? null,
      phase: i.job.phase ?? null,
    };
  }
  if (local.downloadRequested) {
    return { kind: "downloading", version: offered, percent: null, phase: "resolving" };
  }
  if (i.job?.state === "done" && i.job.result !== undefined) {
    const result = i.job.result;
    if (result.status === "updated") {
      return {
        kind: "ready",
        version: i.job.targetVersion,
        restart: local.restart === "manual" ? "manual" : "auto",
      };
    }
    if (result.status === "unsupported") {
      return {
        kind: "unsupported",
        reason:
          result.reason === "not_launched_via_cli"
            ? { code: "not_launched_via_cli" }
            : { code: "cli_refused", detail: result.output },
      };
    }
    return {
      kind: "error",
      message: null,
      detail: result.output === "" ? null : result.output,
      retry: "download",
    };
  }
  if (local.checking) return { kind: "checking" };
  if (i.update === null) return { kind: "unknown" };
  const outcome = updateCheckOutcome(i.update);
  switch (outcome.kind) {
    case "disabled":
      return { kind: "disabled" };
    case "failed":
      return { kind: "error", message: null, detail: null, retry: "check" };
    case "found":
      return {
        kind: "available",
        version: outcome.latestVersion,
        releaseUrl: i.update.releaseUrl,
        canInstall: i.isAdmin,
      };
    default:
      return { kind: "up-to-date", version: i.update.currentVersion };
  }
}

/** The flow of the desktop shell's own window: the shell's snapshot is the whole story, plus what the page has on the wire. */
export function clientFlow(status: DesktopUpdateStatus | null, local: FlowLocal): UpdateFlow {
  if (local.restart === "requested")
    return { kind: "restarting", version: status?.version ?? null };
  if (status === null) return local.checking ? { kind: "checking" } : { kind: "unknown" };
  switch (status.state) {
    case "unsupported":
      return {
        kind: "unsupported",
        reason:
          status.reason === "linux-not-appimage" ? { code: "linux-not-appimage" } : { code: "dev" },
      };
    case "checking":
      return { kind: "checking" };
    case "up-to-date":
      return local.checking
        ? { kind: "checking" }
        : { kind: "up-to-date", version: status.appVersion };
    case "available":
      if (local.downloadRequested) {
        return { kind: "downloading", version: status.version ?? null, percent: null, phase: null };
      }
      return status.version !== undefined
        ? {
            kind: "available",
            version: status.version,
            releaseUrl: releaseUrlFor(status.version),
            canInstall: true,
          }
        : { kind: "unknown" };
    case "downloading":
      return {
        kind: "downloading",
        version: status.version ?? null,
        percent: status.percent ?? null,
        phase: null,
      };
    case "downloaded":
      return { kind: "ready", version: status.version ?? null, restart: "auto" };
    case "error":
      return local.checking
        ? { kind: "checking" }
        : { kind: "error", message: status.message ?? null, detail: null, retry: "check" };
    default:
      return local.checking ? { kind: "checking" } : { kind: "unknown" };
  }
}

/** The account-menu row's render mode; busy / dot / action derive from it so they cannot disagree. */
export type UpdateRowLabel =
  "check" | "checking" | "available" | "downloading" | "ready" | "restarting" | "unsupported";

export interface UpdateRowModel {
  label: UpdateRowLabel;
  /** The newer release the label names, when it names one. */
  version: string | null;
  /** Download progress, when the label carries one. */
  percent: number | null;
  /** Spinner: something is moving. */
  busy: boolean;
  /** Accent dot: something is waiting for the user (an offer, or a restart). */
  dot: boolean;
  /**
   * The row speaks: a status line under its label names where the flow stands. Only while
   * something moves or waits — an idle row says nothing, and an install that cannot update
   * itself would otherwise say so on every menu open.
   */
  announces: boolean;
}

/** What the row says for one flow. Every state opens the App info dialog, which explains each one. */
export function updateRowModel(flow: UpdateFlow): UpdateRowModel {
  const quiet = { version: null, percent: null, busy: false, dot: false, announces: false };
  switch (flow.kind) {
    case "checking":
      return { ...quiet, label: "checking", busy: true, announces: true };
    case "available":
      return { ...quiet, label: "available", version: flow.version, dot: true, announces: true };
    case "downloading":
      return {
        ...quiet,
        label: "downloading",
        version: flow.version,
        percent: flow.percent,
        busy: true,
        announces: true,
      };
    case "ready":
      return { ...quiet, label: "ready", version: flow.version, dot: true, announces: true };
    case "restarting":
      return { ...quiet, label: "restarting", version: flow.version, busy: true, announces: true };
    case "unsupported":
      return { ...quiet, label: "unsupported" };
    default:
      return { ...quiet, label: "check" };
  }
}

/** What the version line's superscript says, or null when nothing is waiting — a button into the App info dialog in every case. */
export type VersionBadge = "available" | "downloading" | "ready";

export function versionBadgeFor(flow: UpdateFlow): VersionBadge | null {
  if (flow.kind === "available" || flow.kind === "downloading" || flow.kind === "ready") {
    return flow.kind;
  }
  return null;
}
