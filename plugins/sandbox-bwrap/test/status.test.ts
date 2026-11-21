/**
 * This backend's page in Settings (src/status.ts), from where the sandbox says it stands.
 *
 * - In use: the summary says so, the version element names the bubblewrap it runs and where it
 *   comes from, and the base-profile check holds.
 * - Refused by its check: the check needs action, with the sandbox's own words folded under it.
 * - Off Linux (declined): the page says it does not apply here, and offers nothing to check.
 * - Every state offers "check again", except where the backend does not apply.
 */
import { describe, expect, it } from "vitest";
import { bwrapReport, standingOf } from "../src/status.js";

const view = (state: "serving" | "refused" | "declined") => ({
  backends: () => (state === "serving" ? [{ name: "penguin-bwrap" }] : []),
  failures: () =>
    state === "refused"
      ? [{ name: "penguin-bwrap", reason: "bwrap: setting up uid map: Permission denied" }]
      : [],
  declined: () => (state === "declined" ? ["penguin-bwrap"] : []),
  retryFailed: async () => {},
});

const linux = (state: "serving" | "refused") =>
  bwrapReport({
    standing: standingOf(view(state), "penguin-bwrap"),
    platform: "linux",
    arch: "x64",
    runner: "/opt/vendor/bwrap",
    source: "shipped",
    version: "0.11.2",
  });

describe("the bubblewrap page", () => {
  it("says it is in use, names the shipped bubblewrap, and the base profile holds", () => {
    const report = linux("serving");
    expect(report.summary).toMatchObject({ state: "ready" });
    expect(report.version).toMatchObject({
      name: "bubblewrap",
      state: "installed",
      version: "0.11.2",
      platform: "linux-x64",
      text: "Shipped with this plugin",
    });
    expect(report.checks?.[0]).toMatchObject({ id: "base-profile", state: "ok" });
    expect(report.recheck).toBe("check");
  });

  it("asks for action when the check refuses, with the sandbox's words folded under it", () => {
    const check = linux("refused").checks?.[0];
    expect(check).toMatchObject({ state: "action" });
    expect(check?.details).toBe("bwrap: setting up uid map: Permission denied");
  });

  it("says it does not apply off Linux, and offers nothing to check", () => {
    const report = bwrapReport({
      standing: standingOf(view("declined"), "penguin-bwrap"),
      platform: "win32",
      arch: "x64",
      runner: "bwrap",
      source: "path",
      version: null,
    });
    expect(report.version).toMatchObject({ state: "unsupported" });
    expect(report.checks).toEqual([expect.objectContaining({ state: "na" })]);
    expect(report.recheck).toBeUndefined();
  });
});
