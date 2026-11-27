/**
 * A server install's staged bar (src/features/plugins/install-progress.ts).
 *
 * - The plan lists only the stages that will happen: an install here checks, fetches and starts;
 *   enabling a shipped plugin and an install on another machine only start; a package known to
 *   carry no server part does not start; Agents come last only where the reader chooses them.
 * - Through every order the server reports an install in, the bar never moves back, and it is
 *   not full while the server works or while the Agents are still to be chosen.
 * - A failed install's bar stops where the server's last report stood.
 */
import { describe, expect, it } from "vitest";
import { stagedShare } from "@prismshadow/penguin-ui";
import type { InstallStage } from "../src/api/endpoints";
import {
  furthest,
  installBar,
  installPlan,
  installReading,
  placeOf,
  planStages,
  type BarPlace,
  type DownloadProgress,
  type InstallStep,
} from "@prismshadow/penguin-library-plugin/web/install-progress";

type Report = { stage: InstallStage } | { progress: DownloadProgress };
const stage = (s: InstallStage): Report => ({ stage: s });
const bytes = (received: number, total: number | null): Report => ({
  progress: { received, total },
});

const CHECK = stage({ stage: "checking" });
const REGISTRY = stage({ stage: "installing", source: "registry" });
const CHANNEL = stage({ stage: "installing", source: "channel" });
const OFFLINE = stage({ stage: "installing", source: "offline" });
const LOADING = stage({ stage: "loading" });

/** The share of the bar drawn after each report of one attempt. */
function shares(plan: readonly InstallStep[], reports: readonly Report[]): number[] {
  let reached: BarPlace | null = null;
  return reports.map((report) => {
    const reading =
      "progress" in report
        ? installReading(null, report.progress)
        : installReading(report.stage, null);
    reached = furthest(reached, placeOf(plan, reading));
    const bar = installBar(plan, "running", reached);
    return stagedShare(planStages(plan), bar.current, bar.value);
  });
}

describe("the install plan", () => {
  it("lists only the stages that will happen", () => {
    expect(installPlan({ server: "install", agents: true })).toEqual([
      "check",
      "fetch",
      "start",
      "agents",
    ]);
    expect(installPlan({ server: "install", modules: false, agents: true })).toEqual([
      "check",
      "fetch",
      "agents",
    ]);
    expect(installPlan({ server: "install", remote: true, agents: false })).toEqual(["start"]);
    expect(installPlan({ server: "enable", agents: false })).toEqual(["start"]);
    expect(installPlan({ server: "none", agents: true })).toEqual(["agents"]);
  });
});

describe("the bar through an install", () => {
  const full = installPlan({ server: "install", agents: true });
  const orders: Record<string, Report[]> = {
    "from the registry": [CHECK, REGISTRY, LOADING],
    "from a release channel": [
      CHECK,
      REGISTRY,
      CHANNEL,
      bytes(0, 100),
      bytes(40, 100),
      bytes(100, 100),
      LOADING,
    ],
    "from the offline archive": [CHECK, REGISTRY, OFFLINE, LOADING],
    "a download of unknown size": [CHECK, REGISTRY, CHANNEL, bytes(10, null), bytes(90, null)],
    "a stale report after a later one": [CHECK, REGISTRY, bytes(60, 100), bytes(30, 100), CHECK],
  };
  it.each(Object.entries(orders))("never moves back and never fills: %s", (_name, reports) => {
    const seen = shares(full, reports);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]!);
    expect(Math.max(...seen)).toBeLessThan(1);
  });

  it("stands on the plan's own stage for a report the plan leaves out", () => {
    const enable = installPlan({ server: "enable", agents: true });
    expect(placeOf(enable, installReading({ stage: "checking" }, null)).current).toBe(0);
    expect(shares(enable, [LOADING])).toEqual([0]);
  });

  it("waits on the Agents with the server's stages full, and is full only when done", () => {
    const stages = planStages(full);
    const choosing = installBar(full, "agents", null);
    expect(choosing).toEqual({ current: 3, status: "waiting" });
    expect(stagedShare(stages, choosing.current)).toBeLessThan(1);
    expect(stagedShare(stages, installBar(full, "done", null).current)).toBe(1);
  });

  it("stops a failed install where the server's last report stood", () => {
    const at = placeOf(full, installReading(null, { received: 62, total: 100 }));
    expect(installBar(full, "failed", at)).toEqual({ current: 1, value: 0.62, status: "stopped" });
    expect(installBar(full, "failed", null)).toEqual({ current: 0, status: "stopped" });
  });
});
