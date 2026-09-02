/**
 * Update-badge gate unit tests: what raises a notification dot, and what an anchor over
 * several trails says. The rule every case here defends is that a dot must end in a control
 * the user can actually reach — so the software gate reads the update flow (which offers
 * nothing where the session can update nothing), and a download still in flight is not a
 * badge.
 *
 * The Agent-kernel gate used to live here as `anyKernelOutdated`. It moved to `todo-badges.ts`
 * (and is covered there, as `kernelUpdateTodo`) when its page grew a notice with a way down: a
 * gate that can be dismissed has to name WHAT is waiting, not just whether something is.
 */
import { describe, expect, it } from "vitest";
import { badgeNote, softwareUpdate } from "../src/lib/update-badges";

describe("softwareUpdate", () => {
  it("offers a release the flow has on offer", () => {
    expect(
      softwareUpdate({ kind: "available", version: "0.3.0", releaseUrl: null, canInstall: true }),
    ).toEqual({ kind: "available", version: "0.3.0" });
  });

  it("offers a downloaded or installed release waiting for its restart, unnamed included", () => {
    expect(softwareUpdate({ kind: "ready", version: "0.3.0", restart: "auto" })).toEqual({
      kind: "ready",
      version: "0.3.0",
    });
    expect(softwareUpdate({ kind: "ready", version: null, restart: "manual" })).toEqual({
      kind: "ready",
      version: null,
    });
  });

  it("does not badge a download still in flight", () => {
    // The row shows its progress; there is nothing for the user to do until it lands, and a
    // badge the user cannot clear by acting on it is noise.
    expect(
      softwareUpdate({ kind: "downloading", version: "0.3.0", percent: 40, phase: null }),
    ).toBeNull();
  });

  it("stays silent for every other state — nothing known, current, checking, failed, unsupported", () => {
    expect(softwareUpdate({ kind: "unknown" })).toBeNull();
    expect(softwareUpdate({ kind: "checking" })).toBeNull();
    expect(softwareUpdate({ kind: "up-to-date", version: "0.2.9" })).toBeNull();
    expect(softwareUpdate({ kind: "disabled" })).toBeNull();
    expect(
      softwareUpdate({ kind: "error", message: null, detail: null, retry: "check" }),
    ).toBeNull();
    expect(softwareUpdate({ kind: "unsupported", reason: { code: "dev" } })).toBeNull();
    expect(softwareUpdate({ kind: "restarting", version: "0.3.0" })).toBeNull();
  });
});

describe("badgeNote", () => {
  const release = { kind: "available", version: "0.2.0" } as const;
  const kernel = { kind: "kernel" } as const;
  const errors = { kind: "errors", count: 2 } as const;

  it("says nothing when nothing is waiting", () => {
    expect(badgeNote([])).toEqual({ kind: "none" });
  });

  it("names the release when only software is updatable", () => {
    expect(badgeNote([release])).toEqual(release);
  });

  it("carries a client build's version through, null included", () => {
    expect(badgeNote([{ kind: "ready", version: null }])).toEqual({
      kind: "ready",
      version: null,
    });
  });

  it("names a single to-do trail, count included", () => {
    expect(badgeNote([{ kind: "plugins", count: 3 }])).toEqual({ kind: "plugins", count: 3 });
  });

  it("names none of them when several trails have something", () => {
    // The combined anchor leads to all of them; naming one would point at the wrong trail.
    expect(badgeNote([release, kernel])).toEqual({ kind: "mixed", updatesOnly: true });
  });

  it("keeps the combined case an update only while every source is one", () => {
    expect(badgeNote([kernel, { kind: "models", count: 1 }])).toEqual({
      kind: "mixed",
      updatesOnly: true,
    });
    // An unexpected error is not an update by any reading, so the wider wording is required.
    expect(badgeNote([kernel, errors])).toEqual({ kind: "mixed", updatesOnly: false });
  });
});
