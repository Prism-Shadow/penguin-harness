/**
 * This backend's page in Settings (src/report.ts), from what the status reads of the machine.
 *
 * - Off Windows: the page says it does not apply here, with one not-applicable check.
 * - WSL missing: the version element offers Install; while it installs, it shows the step.
 * - Initialized, last check clean: in use, the distro holds, each check line holds, and "check
 *   again" runs the confinement check.
 * - Not initialized: the distro's row offers Initialize, and there is nothing to check again.
 */
import { describe, expect, it } from "vitest";
import { wslReport, type WslFacts } from "../src/report.js";

const host = { wsl: "installed" as const, version: "2.7.0", distros: ["penguin-sandbox"] };
const state = {
  distro: "penguin-sandbox",
  user: "agent",
  base: "ubuntu",
  version: "24.04",
  packages: [],
  initializedAt: "2026-11-20T00:00:00Z",
};
const facts = (over: Partial<WslFacts>): WslFacts => ({
  platform: "win32",
  host,
  running: null,
  last: null,
  state,
  distro: "penguin-sandbox",
  initialized: true,
  lastCheck: null,
  ...over,
});

describe("the WSL page", () => {
  it("says it does not apply off Windows", () => {
    const report = wslReport(facts({ platform: "linux" }));
    expect(report.version).toMatchObject({ state: "unsupported" });
    expect(report.checks).toEqual([expect.objectContaining({ state: "na" })]);
  });

  it("offers Install when WSL is missing, and shows the step while it installs", () => {
    const missing = { wsl: "missing" as const, distros: [] };
    expect(wslReport(facts({ host: missing, initialized: false })).version).toMatchObject({
      state: "missing",
      action: "install",
    });
    const installing = wslReport(
      facts({
        host: missing,
        initialized: false,
        running: { kind: "install", step: { en: "Enabling WSL", zh: "正在启用 WSL" } },
      }),
    );
    expect(installing.version).toMatchObject({ state: "preparing", text: "Enabling WSL" });
  });

  it("is in use once initialized and checked clean, and checks again on request", () => {
    const report = wslReport(
      facts({
        lastCheck: {
          lines: [
            { name: { en: "Interop is off", zh: "interop 已关闭" }, ok: true, detail: "" },
            { name: { en: "Network cut", zh: "网络已断开" }, ok: true, detail: "" },
          ],
        },
      }),
    );
    expect(report.summary).toMatchObject({ state: "ready" });
    expect(report.version).toMatchObject({ state: "installed", version: "2.7.0" });
    expect(report.checks?.map((c) => c.state)).toEqual(["ok", "ok", "ok"]);
    expect(report.recheck).toBe("check");
  });

  it("offers Initialize on the distro's row until it is initialized", () => {
    const report = wslReport(facts({ state: null, initialized: false }));
    expect(report.checks?.[0]).toMatchObject({
      id: "distro",
      state: "action",
      action: "initialize",
    });
    expect(report.recheck).toBeUndefined();
  });
});
