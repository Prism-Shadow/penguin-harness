/**
 * desktop-update.ts unit tests: who gets the client-update row, what it renders per
 * shell snapshot, and when a row-initiated check counts as settled (one toast per
 * outcome).
 *
 * offersClientUpdate is pinned in all four combinations for the same reason as
 * offersChangePassword next door: each single-field simplification fails a real case —
 * `desktopMode` alone offers a remote browser a button that restarts someone else's
 * GUI app, `sessionVia` alone offers it to a stale desktop cookie replayed against a
 * plain server with no shell listening. vitest runs node-only here, so this asserts
 * the pure helpers, not a rendered row (account-menu.test.ts convention).
 */
import { describe, expect, it } from "vitest";
import type { DesktopUpdateStatus } from "@prismshadow/penguin-server/api";
import { clientCheckSettle, clientUpdateRow, offersClientUpdate } from "../src/lib/desktop-update";

describe("offersClientUpdate", () => {
  it("offers the row only in the desktop shell's own window", () => {
    expect(offersClientUpdate({ desktopMode: true, sessionVia: "desktop" })).toBe(true);
    expect(offersClientUpdate({ desktopMode: true, sessionVia: "password" })).toBe(false);
    expect(offersClientUpdate({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
    expect(offersClientUpdate({ desktopMode: false, sessionVia: "password" })).toBe(false);
  });
});

const at = (state: DesktopUpdateStatus["state"], rest: Partial<DesktopUpdateStatus> = {}) =>
  ({ appVersion: "0.2.3", state, ...rest }) as DesktopUpdateStatus;

describe("clientUpdateRow", () => {
  it("offers the check before any shell push, without a version chip", () => {
    expect(clientUpdateRow(null)).toMatchObject({
      action: "check",
      busy: false,
      labelKind: "check",
      appVersion: null,
    });
  });

  it("offers the (re-)check for idle, up-to-date and error snapshots", () => {
    for (const state of ["idle", "up-to-date", "error"] as const) {
      expect(clientUpdateRow(at(state))).toMatchObject({
        action: "check",
        busy: false,
        labelKind: "check",
        appVersion: "0.2.3",
      });
    }
  });

  it("renders busy states without an action", () => {
    expect(clientUpdateRow(at("checking"))).toMatchObject({
      action: "none",
      busy: true,
      labelKind: "checking",
    });
    expect(clientUpdateRow(at("downloading", { version: "0.3.0", percent: 42 }))).toMatchObject({
      action: "none",
      busy: true,
      labelKind: "downloading",
      version: "0.3.0",
      percent: 42,
    });
  });

  it("offers the install once a build is downloaded", () => {
    expect(clientUpdateRow(at("downloaded", { version: "0.3.0" }))).toMatchObject({
      action: "install",
      busy: false,
      labelKind: "install",
      version: "0.3.0",
    });
  });

  it("disables the row for an unsupported form, naming the reason", () => {
    expect(clientUpdateRow(at("unsupported", { reason: "linux-not-appimage" }))).toMatchObject({
      action: "none",
      busy: false,
      labelKind: "unsupported",
      unsupportedReason: "linux-not-appimage",
    });
  });

  it("drops an empty appVersion (the pre-init placeholder) from the chip", () => {
    expect(clientUpdateRow({ appVersion: "", state: "idle" }).appVersion).toBeNull();
  });
});

describe("clientCheckSettle", () => {
  it("stays open while checking or before any snapshot", () => {
    expect(clientCheckSettle(at("idle"), null, false)).toBeNull();
    expect(clientCheckSettle(at("idle"), at("checking"), false)).toBeNull();
  });

  it("stays open while the snapshot still equals the pre-click one", () => {
    expect(clientCheckSettle(at("up-to-date"), at("up-to-date"), false)).toBeNull();
  });

  it("settles on a changed terminal snapshot", () => {
    expect(clientCheckSettle(at("idle"), at("up-to-date"), false)).toEqual({ kind: "up-to-date" });
    expect(clientCheckSettle(at("idle"), at("error", { message: "x" }), false)).toEqual({
      kind: "failed",
    });
    expect(
      clientCheckSettle(at("idle"), at("downloading", { version: "0.3.0", percent: 1 }), false),
    ).toEqual({ kind: "found", version: "0.3.0" });
    expect(clientCheckSettle(at("idle"), at("downloaded", { version: "0.3.0" }), false)).toEqual({
      kind: "found",
      version: "0.3.0",
    });
  });

  it("settles an unchanged up-to-date once a checking frame proved the round trip", () => {
    expect(clientCheckSettle(at("up-to-date"), at("up-to-date"), true)).toEqual({
      kind: "up-to-date",
    });
  });
});
