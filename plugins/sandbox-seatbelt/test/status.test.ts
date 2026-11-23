/**
 * This backend's page in Settings (src/status.ts), from where the sandbox says it stands.
 *
 * - In use on macOS: the version element names macOS's own sandbox-exec, and the profile holds.
 * - Refused by its check: the check needs action, with the sandbox's own words folded under it.
 * - Off macOS: the page says it does not apply here, and offers nothing to check.
 */
import { describe, expect, it } from "vitest";
import { seatbeltReport } from "../src/status.js";

describe("the Seatbelt page", () => {
  it("names macOS's own sandbox-exec, and the profile holds", () => {
    const report = seatbeltReport({
      standing: { kind: "serving" },
      platform: "darwin",
      arch: "arm64",
      runner: "/usr/bin/sandbox-exec",
    });
    expect(report.version).toMatchObject({ state: "installed", text: "Part of macOS" });
    expect(report.checks?.[0]).toMatchObject({ state: "ok" });
    expect(report.recheck).toBe("check");
  });

  it("asks for action when the check refuses, with the sandbox's words folded under it", () => {
    const report = seatbeltReport({
      standing: { kind: "refused", reason: "'/x' is missing" },
      platform: "darwin",
      arch: "arm64",
      runner: "/x",
    });
    expect(report.checks?.[0]).toMatchObject({ state: "action", details: "'/x' is missing" });
    expect(report.version).toMatchObject({ state: "failed" });
  });

  it("says it does not apply off macOS", () => {
    const report = seatbeltReport({
      standing: { kind: "declined" },
      platform: "linux",
      arch: "x64",
      runner: "/usr/bin/sandbox-exec",
    });
    expect(report.checks).toEqual([expect.objectContaining({ state: "na" })]);
    expect(report.recheck).toBeUndefined();
  });
});
