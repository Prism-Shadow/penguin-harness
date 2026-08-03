/**
 * updateCheckOutcome unit tests: the manual "check for updates" action turns one fail-soft
 * server response into exactly one user notice — disabled beats error, error beats found,
 * and "found" requires the release to be named so the toast and row have something to show.
 */
import { describe, expect, it } from "vitest";
import type { UpdateCheckResponse } from "@prismshadow/penguin-server/api";
import { updateCheckOutcome } from "../src/lib/use-version-info";

function response(overrides: Partial<UpdateCheckResponse>): UpdateCheckResponse {
  return {
    currentVersion: "0.1.5",
    buildDate: null,
    latestVersion: null,
    updateAvailable: false,
    releaseUrl: null,
    publishedAt: null,
    checkedAt: "2026-08-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("updateCheckOutcome", () => {
  it("classifies an up-to-date result", () => {
    expect(updateCheckOutcome(response({ latestVersion: "0.1.5" }))).toEqual({
      kind: "up-to-date",
    });
  });

  it("classifies a newer release with its version", () => {
    expect(updateCheckOutcome(response({ latestVersion: "0.2.0", updateAvailable: true }))).toEqual(
      { kind: "found", latestVersion: "0.2.0" },
    );
  });

  it("updateAvailable without a named release falls back to up-to-date, never a blank notice", () => {
    expect(updateCheckOutcome(response({ updateAvailable: true }))).toEqual({
      kind: "up-to-date",
    });
  });

  it("a failed lookup wins over updateAvailable", () => {
    expect(
      updateCheckOutcome(
        response({ error: "network", updateAvailable: true, latestVersion: "0.2.0" }),
      ),
    ).toEqual({ kind: "failed" });
  });

  it("disabled wins over everything — no lookup ran", () => {
    expect(
      updateCheckOutcome(response({ disabled: true, error: "network", updateAvailable: true })),
    ).toEqual({ kind: "disabled" });
  });
});
