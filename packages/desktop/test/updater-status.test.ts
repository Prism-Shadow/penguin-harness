/**
 * updater-status.ts unit tests: the event → snapshot fold behind the account-menu
 * client-update row, and the port frame helpers.
 *
 * The one behavioral rule worth pinning hard is the `downloaded` precedence: once a
 * build is on disk, later checking/error/up-to-date events must not replace the
 * "restart to install" snapshot — a periodic re-check failing on a train's Wi-Fi would
 * otherwise hide the one actionable step.
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

  it("walks the download path: available → progress → downloaded", () => {
    const downloading = fold([{ kind: "checking" }, { kind: "available", version: "1.1.0" }]);
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

  it("keeps a downloaded build over later checking / error / up-to-date / available events", () => {
    const downloaded = fold([{ kind: "downloaded", version: "1.1.0" }]);
    for (const ev of [
      { kind: "checking" },
      { kind: "error", message: "offline" },
      { kind: "not-available" },
      { kind: "available", version: "1.2.0" },
      { kind: "progress", percent: 10 },
    ] satisfies UpdaterEvent[]) {
      expect(nextUpdateStatus(downloaded, ev)).toBe(downloaded);
    }
  });

  it("lets a newer downloaded build replace the held one", () => {
    const downloaded = fold([{ kind: "downloaded", version: "1.1.0" }]);
    expect(nextUpdateStatus(downloaded, { kind: "downloaded", version: "1.2.0" })).toEqual({
      appVersion: "1.0.0",
      state: "downloaded",
      version: "1.2.0",
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

  it("accepts exactly the two command frames", () => {
    expect(parseUpdaterCommand({ type: "desktop-updater-command", action: "check" })).toBe("check");
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
