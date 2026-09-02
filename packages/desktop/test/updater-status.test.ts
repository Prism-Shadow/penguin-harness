/**
 * updater-status.ts unit tests: the event → snapshot fold behind the account-menu
 * client-update row, and the port frame helpers.
 *
 * Three behavioral rules are worth pinning hard. A check ends in `available` and never
 * downloads on its own — the fetch begins on `download-started`, the user's say-so. Then
 * `downloaded` suppresses transient noise (a re-check failing on a train's Wi-Fi must not
 * hide the one actionable step) but yields to a *different* version being fetched — a
 * replacement download invalidates the held package, so keeping the old headline would
 * point the install at a deleted file. And `downloading` suppresses a concurrent check's
 * `checking`, which would drop the download context and every later progress tick with it.
 */
import { describe, expect, it } from "vitest";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import {
  initialUpdateStatus,
  nextUpdateStatus,
  parseUpdaterCommand,
  updaterStatusMessage,
} from "../src/updater-status.js";
import type { UpdaterEvent } from "../src/updater-status.js";

function fold(events: UpdaterEvent[], from = initialUpdateStatus("1.0.0")): DesktopUpdateStatus {
  return events.reduce(nextUpdateStatus, from);
}

describe("nextUpdateStatus", () => {
  it("starts idle with the app version", () => {
    expect(initialUpdateStatus("1.2.3")).toEqual({ appVersion: "1.2.3", state: "idle" });
  });

  it("walks the up-to-date path: checking → not-available", () => {
    expect(fold([{ kind: "checking" }])).toEqual({ appVersion: "1.0.0", state: "checking" });
    expect(fold([{ kind: "checking" }, { kind: "not-available" }])).toEqual({
      appVersion: "1.0.0",
      state: "up-to-date",
    });
  });

  it("walks the download path: available → download-started → progress → downloaded", () => {
    // A check only offers: nothing is fetched until the user says so.
    const offered = fold([{ kind: "checking" }, { kind: "available", version: "1.1.0" }]);
    expect(offered).toEqual({ appVersion: "1.0.0", state: "available", version: "1.1.0" });
    const downloading = nextUpdateStatus(offered, { kind: "download-started", version: "1.1.0" });
    expect(downloading).toEqual({
      appVersion: "1.0.0",
      state: "downloading",
      version: "1.1.0",
      percent: 0,
    });
    expect(nextUpdateStatus(downloading, { kind: "progress", percent: 42 })).toEqual({
      appVersion: "1.0.0",
      state: "downloading",
      version: "1.1.0",
      percent: 42,
    });
    expect(nextUpdateStatus(downloading, { kind: "downloaded", version: "1.1.0" })).toEqual({
      appVersion: "1.0.0",
      state: "downloaded",
      version: "1.1.0",
    });
  });

  it("ignores a progress tick outside a download (stale timer)", () => {
    const idle = initialUpdateStatus("1.0.0");
    expect(nextUpdateStatus(idle, { kind: "progress", percent: 90 })).toBe(idle);
  });

  it("records errors with their message", () => {
    expect(fold([{ kind: "error", message: "boom" }])).toEqual({
      appVersion: "1.0.0",
      state: "error",
      message: "boom",
    });
  });

  it("keeps a downloaded build over transient noise: checking / error / up-to-date / same-version re-announces", () => {
    const downloaded = fold([{ kind: "downloaded", version: "1.1.0" }]);
    for (const ev of [
      { kind: "checking" },
      { kind: "error", message: "offline" },
      { kind: "not-available" },
      { kind: "available", version: "1.1.0" },
      { kind: "downloaded", version: "1.1.0" },
      { kind: "progress", percent: 10 },
    ] satisfies UpdaterEvent[]) {
      expect(nextUpdateStatus(downloaded, ev)).toBe(downloaded);
    }
  });

  it("yields a downloaded build to a different version being offered or fetched (the held package is being replaced)", () => {
    const downloaded = fold([{ kind: "downloaded", version: "1.1.0" }]);
    expect(nextUpdateStatus(downloaded, { kind: "available", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "available",
      version: "1.2.0",
    });
    expect(nextUpdateStatus(downloaded, { kind: "download-started", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "downloading",
      version: "1.2.0",
      percent: 0,
    });
    expect(nextUpdateStatus(downloaded, { kind: "downloaded", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "downloaded",
      version: "1.2.0",
    });
  });

  it("keeps a standing offer over a re-check's checking and its same-version re-announce", () => {
    const offered = fold([{ kind: "available", version: "1.1.0" }]);
    for (const ev of [
      { kind: "checking" },
      { kind: "available", version: "1.1.0" },
    ] satisfies UpdaterEvent[]) {
      expect(nextUpdateStatus(offered, ev)).toBe(offered);
    }
    // A real answer replaces it: the release was pulled, or another one took its place.
    expect(nextUpdateStatus(offered, { kind: "not-available" })).toEqual({
      appVersion: "1.0.0",
      state: "up-to-date",
    });
    expect(nextUpdateStatus(offered, { kind: "available", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "available",
      version: "1.2.0",
    });
  });

  it("keeps a running download over a concurrent check's noise", () => {
    const downloading = fold([
      { kind: "available", version: "1.1.0" },
      { kind: "download-started", version: "1.1.0" },
    ]);
    for (const ev of [
      { kind: "checking" },
      { kind: "not-available" },
      { kind: "available", version: "1.1.0" },
      { kind: "download-started", version: "1.1.0" },
    ] satisfies UpdaterEvent[]) {
      expect(nextUpdateStatus(downloading, ev)).toBe(downloading);
    }
    // Progress keeps flowing after the suppressed events — the regression this rule exists for.
    expect(nextUpdateStatus(downloading, { kind: "progress", percent: 55 })).toEqual({
      appVersion: "1.0.0",
      state: "downloading",
      version: "1.1.0",
      percent: 55,
    });
  });

  it("lets a running download yield to a different announced version (offered anew), and still fail on its own error", () => {
    const downloading = fold([
      { kind: "available", version: "1.1.0" },
      { kind: "download-started", version: "1.1.0" },
    ]);
    // The package being fetched is invalidated by the replacement; the new one needs the
    // user's say-so again, so it is offered, not fetched.
    expect(nextUpdateStatus(downloading, { kind: "available", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "available",
      version: "1.2.0",
    });
    expect(nextUpdateStatus(downloading, { kind: "error", message: "disk full" })).toEqual({
      appVersion: "1.0.0",
      state: "error",
      message: "disk full",
    });
  });

  it("marks an unsupported form, even over a downloaded build (the form claim is authoritative)", () => {
    expect(fold([{ kind: "unsupported", reason: "dev" }])).toEqual({
      appVersion: "1.0.0",
      state: "unsupported",
      reason: "dev",
    });
    const downloaded = fold([{ kind: "downloaded", version: "1.1.0" }]);
    expect(
      nextUpdateStatus(downloaded, { kind: "unsupported", reason: "linux-not-appimage" }),
    ).toEqual({ appVersion: "1.0.0", state: "unsupported", reason: "linux-not-appimage" });
  });
});

describe("port frames", () => {
  it("wraps a snapshot for the push", () => {
    const status = initialUpdateStatus("1.0.0");
    expect(updaterStatusMessage(status)).toEqual({ type: "desktop-updater-status", status });
  });

  it("accepts exactly the three command frames", () => {
    expect(parseUpdaterCommand({ type: "desktop-updater-command", action: "check" })).toBe("check");
    expect(parseUpdaterCommand({ type: "desktop-updater-command", action: "download" })).toBe(
      "download",
    );
    expect(parseUpdaterCommand({ type: "desktop-updater-command", action: "install" })).toBe(
      "install",
    );
  });

  it("rejects everything else", () => {
    for (const data of [
      null,
      undefined,
      "check",
      42,
      {},
      { type: "desktop-updater-command" },
      { type: "desktop-updater-command", action: "restart" },
      { type: "desktop-updater-status", action: "check" },
    ]) {
      expect(parseUpdaterCommand(data)).toBeNull();
    }
  });
});
