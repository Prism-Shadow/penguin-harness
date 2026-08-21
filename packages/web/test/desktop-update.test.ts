/**
 * desktop-update.ts unit tests: who gets the client-update row, what it renders per
 * shell snapshot, and when an armed row-initiated check settles (one toast per
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
import {
  CLIENT_CHECK_TIMEOUT_MS,
  clientCheckSettle,
  clientUpdateRow,
  offersClientUpdate,
} from "../src/lib/desktop-update";

describe("offersClientUpdate", () => {
  it("offers the row only in the desktop shell's own window", () => {
    expect(offersClientUpdate({ desktopMode: true, sessionVia: "desktop" })).toBe(true);
    expect(offersClientUpdate({ desktopMode: true, sessionVia: "password" })).toBe(false);
    expect(offersClientUpdate({ desktopMode: false, sessionVia: "desktop" })).toBe(false);
    expect(offersClientUpdate({ desktopMode: false, sessionVia: "password" })).toBe(false);
  });
});

const at = (
  state: DesktopUpdateStatus["state"],
  rest: Partial<DesktopUpdateStatus> = {},
): DesktopUpdateStatus => ({ appVersion: "0.2.3", seq: 1, state, ...rest });

describe("clientUpdateRow", () => {
  it("renders disabled until the shell's first push lands", () => {
    expect(clientUpdateRow(null)).toMatchObject({
      labelKind: "unknown",
      action: "none",
      busy: false,
      appVersion: null,
    });
  });

  it("offers the (re-)check for idle, up-to-date and error snapshots", () => {
    for (const state of ["idle", "up-to-date", "error"] as const) {
      expect(clientUpdateRow(at(state))).toMatchObject({
        labelKind: "check",
        action: "check",
        busy: false,
        appVersion: "0.2.3",
      });
    }
  });

  it("spins on an armed check before the shell's checking frame lands", () => {
    expect(clientUpdateRow(at("idle"), true)).toMatchObject({
      labelKind: "checking",
      action: "none",
      busy: true,
    });
    // Once the shell reports its own busy/terminal states, the snapshot wins.
    expect(clientUpdateRow(at("downloaded", { version: "0.3.0" }), true)).toMatchObject({
      labelKind: "install",
    });
  });

  it("renders busy states without an action", () => {
    expect(clientUpdateRow(at("checking"))).toMatchObject({
      labelKind: "checking",
      action: "none",
      busy: true,
    });
    expect(clientUpdateRow(at("downloading", { version: "0.3.0", percent: 42 }))).toMatchObject({
      labelKind: "downloading",
      action: "none",
      busy: true,
      version: "0.3.0",
      percent: 42,
    });
  });

  it("offers the install once a build is downloaded", () => {
    expect(clientUpdateRow(at("downloaded", { version: "0.3.0" }))).toMatchObject({
      labelKind: "install",
      action: "install",
      busy: false,
      version: "0.3.0",
    });
  });

  it("disables the row for an unsupported form, naming the reason", () => {
    expect(clientUpdateRow(at("unsupported", { reason: "linux-not-appimage" }))).toMatchObject({
      labelKind: "unsupported",
      action: "none",
      busy: false,
      unsupportedReason: "linux-not-appimage",
    });
  });
});

describe("clientCheckSettle", () => {
  it("stays open while checking, before any snapshot, or while the seq has not moved", () => {
    expect(clientCheckSettle(1, null, 3_000)).toBeNull();
    expect(clientCheckSettle(1, at("checking", { seq: 2 }), 3_000)).toBeNull();
    expect(clientCheckSettle(1, at("up-to-date", { seq: 1 }), 3_000)).toBeNull();
  });

  it("settles on a terminal state once the seq moved — even to a byte-identical up-to-date", () => {
    expect(clientCheckSettle(1, at("up-to-date", { seq: 3 }), 3_000)).toEqual({
      kind: "up-to-date",
    });
    expect(clientCheckSettle(1, at("error", { seq: 3, message: "x" }), 3_000)).toEqual({
      kind: "failed",
    });
    expect(
      clientCheckSettle(1, at("downloading", { seq: 3, version: "0.3.0", percent: 1 }), 3_000),
    ).toEqual({ kind: "found", version: "0.3.0" });
    expect(clientCheckSettle(1, at("downloaded", { seq: 3, version: "0.3.0" }), 3_000)).toEqual({
      kind: "ready",
      version: "0.3.0",
    });
    expect(clientCheckSettle(1, at("unsupported", { seq: 3, reason: "dev" }), 3_000)).toEqual({
      kind: "unsupported",
      reason: "dev",
    });
  });

  it("falls back to two poll rounds when either side carries no seq", () => {
    const noSeq = { appVersion: "0.2.3", state: "up-to-date" } as DesktopUpdateStatus;
    expect(clientCheckSettle(null, noSeq, 3_000)).toBeNull();
    expect(clientCheckSettle(null, noSeq, 5_000)).toEqual({ kind: "up-to-date" });
  });

  it("times out an armed check that never sees an outcome", () => {
    expect(clientCheckSettle(1, null, CLIENT_CHECK_TIMEOUT_MS)).toEqual({ kind: "failed" });
    expect(clientCheckSettle(1, at("up-to-date", { seq: 1 }), CLIENT_CHECK_TIMEOUT_MS)).toEqual({
      kind: "failed",
    });
    expect(clientCheckSettle(1, at("idle", { seq: 2 }), CLIENT_CHECK_TIMEOUT_MS)).toEqual({
      kind: "failed",
    });
  });
});
