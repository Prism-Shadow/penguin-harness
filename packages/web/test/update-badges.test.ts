/**
 * Update-badge gate unit tests: what raises a notification dot, and what an anchor over both
 * trails says. The rule every case here defends is that a dot must end in a control the user
 * can actually reach — so the release gate is closed wherever the sidebar does not offer the
 * release row, a fail-soft check raises nothing, and a download still in flight is not a badge.
 */
import { describe, expect, it } from "vitest";
import type { DesktopUpdateStatus, UpdateCheckResponse } from "@prismshadow/penguin-server/api";
import {
  anyKernelOutdated,
  releaseUpdate,
  softwareUpdate,
  updateBadgeNote,
} from "../src/lib/update-badges";

function check(overrides: Partial<UpdateCheckResponse>): UpdateCheckResponse {
  return {
    currentVersion: "0.1.5",
    buildDate: null,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: "2026-08-26T00:00:00.000Z",
    ...overrides,
  };
}

const AVAILABLE = check({ updateAvailable: true, latestVersion: "0.2.0" });

function shell(overrides: Partial<DesktopUpdateStatus>): DesktopUpdateStatus {
  return { appVersion: "0.1.5", state: "idle", ...overrides };
}

describe("releaseUpdate", () => {
  it("names the newer release", () => {
    expect(releaseUpdate(AVAILABLE)).toBe("0.2.0");
  });

  it("raises nothing before the check has answered", () => {
    expect(releaseUpdate(null)).toBeNull();
  });

  it("raises nothing when the running version is current", () => {
    expect(releaseUpdate(check({ latestVersion: "0.1.5" }))).toBeNull();
  });

  it("raises nothing when the lookup failed — a fail-soft error is not an update", () => {
    // The response is HTTP 200 with `error` set; updateAvailable stays false, so no badge and
    // no noise. The user hears about a failure only from the manual check they asked for.
    expect(releaseUpdate(check({ error: "network" }))).toBeNull();
    expect(releaseUpdate(check({ error: "rate_limited" }))).toBeNull();
  });

  it("raises nothing when checks are turned off (PENGUIN_UPDATE_CHECK=off)", () => {
    expect(releaseUpdate(check({ disabled: true }))).toBeNull();
  });

  it("raises nothing for an available-but-unnamed release", () => {
    // Every tooltip along the trail names the version; without one the dot would lead to a
    // versionless reminder.
    expect(releaseUpdate(check({ updateAvailable: true }))).toBeNull();
  });
});

describe("softwareUpdate", () => {
  const base = { releaseRowOffered: true, clientRowOffered: false, clientStatus: null };

  it("offers the release when the menu holds the release row", () => {
    expect(softwareUpdate({ ...base, update: AVAILABLE })).toEqual({
      kind: "release",
      version: "0.2.0",
    });
  });

  it("stays silent about a release the running mode never offers a row for", () => {
    // Desktop mode hides the server-update row and updates the client through the shell, so a
    // dot for a newer server release there would point at nothing.
    expect(softwareUpdate({ ...base, releaseRowOffered: false, update: AVAILABLE })).toBeNull();
  });

  it("offers a downloaded client build waiting to be installed", () => {
    expect(
      softwareUpdate({
        releaseRowOffered: false,
        clientRowOffered: true,
        update: null,
        clientStatus: shell({ state: "downloaded", version: "0.3.0" }),
      }),
    ).toEqual({ kind: "client", version: "0.3.0" });
  });

  it("does not badge a client download still in flight", () => {
    // The row shows its progress; there is nothing to act on until it lands, and a badge the
    // user cannot clear by acting on it is noise.
    expect(
      softwareUpdate({
        releaseRowOffered: false,
        clientRowOffered: true,
        update: null,
        clientStatus: shell({ state: "downloading", version: "0.3.0", percent: 40 }),
      }),
    ).toBeNull();
  });

  it("does not badge an idle, checking, up-to-date or unsupported shell", () => {
    for (const state of ["idle", "checking", "up-to-date", "unsupported", "error"] as const) {
      expect(
        softwareUpdate({
          releaseRowOffered: false,
          clientRowOffered: true,
          update: null,
          clientStatus: shell({ state }),
        }),
        state,
      ).toBeNull();
    }
  });

  it("stays silent when neither row is offered", () => {
    // A browser signed into a desktop-mode server gets neither the release row nor the client
    // row (offersClientUpdate's pair), so it gets no software badge either.
    expect(
      softwareUpdate({
        releaseRowOffered: false,
        clientRowOffered: false,
        update: AVAILABLE,
        clientStatus: shell({ state: "downloaded", version: "0.3.0" }),
      }),
    ).toBeNull();
  });

  it("prefers the release when a mode somehow offers both rows", () => {
    expect(
      softwareUpdate({
        releaseRowOffered: true,
        clientRowOffered: true,
        update: AVAILABLE,
        clientStatus: shell({ state: "downloaded", version: "0.3.0" }),
      }),
    ).toEqual({ kind: "release", version: "0.2.0" });
  });
});

describe("anyKernelOutdated", () => {
  it("is true when at least one Agent is behind", () => {
    expect(anyKernelOutdated([{ kernelOutdated: false }, { kernelOutdated: true }])).toBe(true);
  });

  it("is false when every Agent is current", () => {
    expect(anyKernelOutdated([{ kernelOutdated: false }, { kernelOutdated: false }])).toBe(false);
  });

  it("is false for an empty or not-yet-loaded Agent list", () => {
    expect(anyKernelOutdated([])).toBe(false);
  });
});

describe("updateBadgeNote", () => {
  const release = { kind: "release", version: "0.2.0" } as const;

  it("says nothing when nothing is updatable", () => {
    expect(updateBadgeNote(null, false)).toEqual({ kind: "none" });
  });

  it("names the release when only software is updatable", () => {
    expect(updateBadgeNote(release, false)).toEqual(release);
  });

  it("carries a client build's version through, null included", () => {
    expect(updateBadgeNote({ kind: "client", version: null }, false)).toEqual({
      kind: "client",
      version: null,
    });
  });

  it("says kernel when only an Agent is behind", () => {
    expect(updateBadgeNote(null, true)).toEqual({ kind: "kernel" });
  });

  it("names neither when both trails have something", () => {
    // The combined anchor leads to both; naming one of the two would point at the wrong trail.
    expect(updateBadgeNote(release, true)).toEqual({ kind: "mixed" });
  });
});
