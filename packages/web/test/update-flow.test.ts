/**
 * update-flow.ts unit tests: the one state machine behind the update modal, the account-menu
 * row and the version-line badge, fed by the two backends.
 *
 * The rules pinned here are the ones a user sees: nothing is fetched until they confirm (a
 * check ends in `available`, never `downloading`), a download sent to the background still
 * reports through the row, an installed release waits for an explicit restart — and where the
 * process cannot be restarted from the page, the modal says so instead of pretending.
 */
import { describe, expect, it } from "vitest";
import type {
  DesktopUpdateStatus,
  UpdateCheckResponse,
  UpdateJobStatus,
} from "@prismshadow/penguin-server/api";
import {
  NO_LOCAL,
  clientFlow,
  opensWithCheck,
  releaseFlow,
  releaseUrlFor,
  updateModeFor,
  updateRowModel,
  versionBadgeFor,
} from "../src/lib/update-flow";
import type { FlowLocal } from "../src/lib/update-flow";

const check = (over: Partial<UpdateCheckResponse> = {}): UpdateCheckResponse => ({
  currentVersion: "0.2.9",
  buildDate: "2026-08-28",
  latestVersion: "0.3.0",
  updateAvailable: true,
  releaseUrl: "https://github.com/Prism-Shadow/penguin-harness/releases/tag/v0.3.0",
  publishedAt: null,
  checkedAt: "2026-08-28T00:00:00.000Z",
  ...over,
});

const job = (over: Partial<UpdateJobStatus> = {}): UpdateJobStatus => ({
  state: "idle",
  targetVersion: "0.3.0",
  output: "",
  ...over,
});

const shell = (over: Partial<DesktopUpdateStatus> = {}): DesktopUpdateStatus => ({
  appVersion: "0.2.9",
  state: "idle",
  ...over,
});

const release = (
  update: UpdateCheckResponse | null,
  j: UpdateJobStatus | null = null,
  local: Partial<FlowLocal> = {},
  isAdmin = true,
) => releaseFlow({ version: null, update, job: j, isAdmin }, { ...NO_LOCAL, ...local });

describe("updateModeFor", () => {
  it("is the shell's own window, an ordinary server, or nothing at all", () => {
    expect(updateModeFor({ desktopMode: true, sessionVia: "desktop" })).toBe("client");
    expect(updateModeFor({ desktopMode: false, sessionVia: "password" })).toBe("release");
    // A browser signed into a desktop-mode server can update neither.
    expect(updateModeFor({ desktopMode: true, sessionVia: "password" })).toBe("none");
  });
});

describe("releaseFlow (an ordinary server)", () => {
  it("knows nothing until the check answers, and spins while a manual check runs", () => {
    expect(release(null)).toEqual({ kind: "unknown" });
    expect(release(null, null, { checking: true })).toEqual({ kind: "checking" });
  });

  it("reads the check: disabled, failed, offered, or current", () => {
    expect(release(check({ disabled: true, updateAvailable: false }))).toEqual({
      kind: "disabled",
    });
    expect(release(check({ error: "network", updateAvailable: false }))).toMatchObject({
      kind: "error",
      retry: "check",
    });
    expect(release(check())).toEqual({
      kind: "available",
      version: "0.3.0",
      releaseUrl: check().releaseUrl,
      canInstall: true,
    });
    expect(release(check({ updateAvailable: false, latestVersion: "0.2.9" }))).toEqual({
      kind: "up-to-date",
      version: "0.2.9",
    });
  });

  it("offers a non-admin the release without the install", () => {
    expect(release(check(), null, {}, false)).toMatchObject({
      kind: "available",
      canInstall: false,
    });
  });

  it("bridges the download request until the job reports, then follows the job's progress", () => {
    expect(release(check(), null, { downloadRequested: true })).toEqual({
      kind: "downloading",
      version: "0.3.0",
      percent: null,
      phase: "resolving",
    });
    expect(release(check(), job({ state: "running", phase: "downloading", percent: 42 }))).toEqual({
      kind: "downloading",
      version: "0.3.0",
      percent: 42,
      phase: "downloading",
    });
    // A phase without a percentage is an indeterminate bar with the phase's caption.
    expect(release(check(), job({ state: "running", phase: "installing", percent: null }))).toEqual(
      { kind: "downloading", version: "0.3.0", percent: null, phase: "installing" },
    );
  });

  it("waits for the restart once the job installed, and says when that restart is the user's", () => {
    const done = job({
      state: "done",
      result: { status: "updated", output: "…", needsRestart: true },
    });
    expect(release(check(), done)).toEqual({ kind: "ready", version: "0.3.0", restart: "auto" });
    expect(release(check(), done, { restart: "manual" })).toEqual({
      kind: "ready",
      version: "0.3.0",
      restart: "manual",
    });
    expect(release(check(), done, { restart: "requested" })).toEqual({
      kind: "restarting",
      version: "0.3.0",
    });
  });

  it("surfaces a failed run with the command's output and a download retry", () => {
    const failed = job({
      state: "done",
      output: "Upgrade failed; the previous install was left in place.",
      result: {
        status: "failed",
        output: "Upgrade failed; the previous install was left in place.",
        needsRestart: false,
      },
    });
    expect(release(check(), failed)).toEqual({
      kind: "error",
      message: null,
      detail: "Upgrade failed; the previous install was left in place.",
      retry: "download",
    });
  });

  it("names why an install cannot update itself", () => {
    const notCli = job({
      state: "done",
      result: {
        status: "unsupported",
        reason: "not_launched_via_cli",
        output: "",
        needsRestart: false,
      },
    });
    expect(release(check(), notCli)).toEqual({
      kind: "unsupported",
      reason: { code: "not_launched_via_cli" },
    });
    const refused = job({
      state: "done",
      result: { status: "unsupported", output: "runs from a source checkout", needsRestart: false },
    });
    expect(release(check(), refused)).toEqual({
      kind: "unsupported",
      reason: { code: "cli_refused", detail: "runs from a source checkout" },
    });
  });
});

describe("clientFlow (the desktop shell's own window)", () => {
  it("knows nothing before the shell's first push, and spins on an armed check", () => {
    expect(clientFlow(null, NO_LOCAL)).toEqual({ kind: "unknown" });
    expect(clientFlow(null, { ...NO_LOCAL, checking: true })).toEqual({ kind: "checking" });
    expect(clientFlow(shell(), { ...NO_LOCAL, checking: true })).toEqual({ kind: "checking" });
  });

  it("offers a found release with its Releases page — nothing is fetched yet", () => {
    expect(clientFlow(shell({ state: "available", version: "0.3.0" }), NO_LOCAL)).toEqual({
      kind: "available",
      version: "0.3.0",
      releaseUrl: releaseUrlFor("0.3.0"),
      canInstall: true,
    });
  });

  it("bridges the download request until the shell's downloading frame, then follows its percentage", () => {
    expect(
      clientFlow(shell({ state: "available", version: "0.3.0" }), {
        ...NO_LOCAL,
        downloadRequested: true,
      }),
    ).toEqual({ kind: "downloading", version: "0.3.0", percent: null, phase: null });
    expect(
      clientFlow(shell({ state: "downloading", version: "0.3.0", percent: 42 }), NO_LOCAL),
    ).toEqual({ kind: "downloading", version: "0.3.0", percent: 42, phase: null });
  });

  it("waits for the restart once the build is downloaded, and reports the restart itself", () => {
    expect(clientFlow(shell({ state: "downloaded", version: "0.3.0" }), NO_LOCAL)).toEqual({
      kind: "ready",
      version: "0.3.0",
      restart: "auto",
    });
    expect(
      clientFlow(shell({ state: "downloaded", version: "0.3.0" }), {
        ...NO_LOCAL,
        restart: "requested",
      }),
    ).toEqual({ kind: "restarting", version: "0.3.0" });
  });

  it("carries the shell's own failure text, and names why a form cannot update itself", () => {
    expect(clientFlow(shell({ state: "error", message: "sha512 mismatch" }), NO_LOCAL)).toEqual({
      kind: "error",
      message: "sha512 mismatch",
      detail: null,
      retry: "check",
    });
    expect(
      clientFlow(shell({ state: "unsupported", reason: "linux-not-appimage" }), NO_LOCAL),
    ).toEqual({ kind: "unsupported", reason: { code: "linux-not-appimage" } });
    expect(clientFlow(shell({ state: "unsupported", reason: "dev" }), NO_LOCAL)).toEqual({
      kind: "unsupported",
      reason: { code: "dev" },
    });
  });
});

describe("opensWithCheck", () => {
  it("checks on opening when nothing is known, the answer is 'current', or the last check failed", () => {
    expect(opensWithCheck({ kind: "unknown" })).toBe(true);
    expect(opensWithCheck({ kind: "up-to-date", version: "0.2.9" })).toBe(true);
    expect(opensWithCheck({ kind: "error", message: null, detail: null, retry: "check" })).toBe(
      true,
    );
  });

  it("does not disturb an offer, a download, a ready build, or a failed download", () => {
    expect(
      opensWithCheck({ kind: "available", version: "0.3.0", releaseUrl: null, canInstall: true }),
    ).toBe(false);
    expect(
      opensWithCheck({ kind: "downloading", version: "0.3.0", percent: 10, phase: null }),
    ).toBe(false);
    expect(opensWithCheck({ kind: "ready", version: "0.3.0", restart: "auto" })).toBe(false);
    expect(opensWithCheck({ kind: "error", message: null, detail: "x", retry: "download" })).toBe(
      false,
    );
  });
});

describe("updateRowModel and versionBadgeFor", () => {
  it("spins while something moves, dots when something waits, and reads 'check' otherwise", () => {
    expect(updateRowModel({ kind: "unknown" })).toMatchObject({
      label: "check",
      busy: false,
      dot: false,
    });
    expect(updateRowModel({ kind: "checking" })).toMatchObject({ label: "checking", busy: true });
    expect(
      updateRowModel({ kind: "available", version: "0.3.0", releaseUrl: null, canInstall: true }),
    ).toMatchObject({ label: "available", version: "0.3.0", dot: true, busy: false });
    expect(
      updateRowModel({ kind: "downloading", version: "0.3.0", percent: 42, phase: null }),
    ).toMatchObject({ label: "downloading", percent: 42, busy: true, dot: false });
    expect(updateRowModel({ kind: "ready", version: "0.3.0", restart: "auto" })).toMatchObject({
      label: "ready",
      dot: true,
    });
    expect(updateRowModel({ kind: "restarting", version: null })).toMatchObject({
      label: "restarting",
      busy: true,
    });
    expect(updateRowModel({ kind: "unsupported", reason: { code: "dev" } })).toMatchObject({
      label: "unsupported",
      busy: false,
      dot: false,
    });
  });

  it("badges the version line for an offer, a background download and a pending restart only", () => {
    expect(versionBadgeFor({ kind: "unknown" })).toBeNull();
    expect(versionBadgeFor({ kind: "up-to-date", version: "0.2.9" })).toBeNull();
    expect(
      versionBadgeFor({ kind: "available", version: "0.3.0", releaseUrl: null, canInstall: true }),
    ).toBe("available");
    expect(
      versionBadgeFor({ kind: "downloading", version: "0.3.0", percent: null, phase: null }),
    ).toBe("downloading");
    expect(versionBadgeFor({ kind: "ready", version: "0.3.0", restart: "manual" })).toBe("ready");
  });
});
