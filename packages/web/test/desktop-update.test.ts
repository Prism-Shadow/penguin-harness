/**
 * desktop-update.ts unit tests: who gets the client update surface at all, and when an
 * armed row-initiated check settles (one report per outcome — in the modal when it is
 * open, a toast otherwise).
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
      message: "x",
    });
    expect(
      clientCheckSettle(1, at("downloading", { seq: 3, version: "0.3.0", percent: 1 }), 3_000),
    ).toEqual({ kind: "found", version: "0.3.0" });
    // A check ends in an offer now (nothing is fetched until the user says so): found too.
    expect(clientCheckSettle(1, at("available", { seq: 3, version: "0.3.0" }), 3_000)).toEqual({
      kind: "found",
      version: "0.3.0",
    });
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

  it("times out an armed check that never sees an outcome, with nothing to report", () => {
    expect(clientCheckSettle(1, null, CLIENT_CHECK_TIMEOUT_MS)).toEqual({
      kind: "failed",
      message: null,
    });
    expect(clientCheckSettle(1, at("up-to-date", { seq: 1 }), CLIENT_CHECK_TIMEOUT_MS)).toEqual({
      kind: "failed",
      message: null,
    });
    expect(clientCheckSettle(1, at("idle", { seq: 2 }), CLIENT_CHECK_TIMEOUT_MS)).toEqual({
      kind: "failed",
      message: null,
    });
  });

  it("keeps the shell's failure text when the updater reported one", () => {
    // A download that fails its sha512, or (Windows) its Authenticode publisher check,
    // arrives as `error` too — reporting it as a failed *check* would be wrong, and
    // would flatten a signature rejection into a network hiccup.
    const invalidSignature = at("error", {
      seq: 9,
      message: "New version 0.3.0 is not signed by the application owner",
    });
    expect(clientCheckSettle(1, invalidSignature, 3_000)).toEqual({
      kind: "failed",
      message: "New version 0.3.0 is not signed by the application owner",
    });
    // An `error` snapshot the shell left messageless still settles, with nothing to add.
    expect(clientCheckSettle(1, at("error", { seq: 9 }), 3_000)).toEqual({
      kind: "failed",
      message: null,
    });
  });
});
