/**
 * The card's structured half on the plugin status page: what each element shows for each state
 * of agent-desktop's install and of this machine.
 *
 * - Given agent-desktop missing or failed, the version element offers Install (Retry) on itself,
 *   and a failure says where the download comes from, with the raw error only in details.
 * - Given an install in progress, the version element is preparing with its progress, and no
 *   summary repeats it.
 * - Given agent-desktop installed, the version and platform show, the checks come labelled in
 *   both languages (a failing one marked for action, on macOS with Open System Settings on it),
 *   the idle-time row among them, and the block has its single recheck.
 * - Given a host that asks for the report, the notices keep only what has no element of its own;
 *   an older host that never asks still gets them all.
 */
import { describe, expect, it } from "vitest";
import type { ProbeResult } from "../src/probe.js";
import type { InstallState } from "../src/service.js";
import { computerUseStatus } from "../src/status.js";

function card(
  state: InstallState,
  opts: { platform?: NodeJS.Platform; probe?: ProbeResult | null } = {},
) {
  const service = {
    pin: { version: "1.3.1" },
    platform: opts.platform ?? "linux",
    settings: () => ({ enabled: true }),
    refresh: async () => {},
    state: () => state,
  };
  const probe = { touch: () => opts.probe ?? null, latest: () => opts.probe ?? null };
  return computerUseStatus(() => ({ service, probe }) as never);
}

describe("the status page's report", () => {
  it("offers Install on the version element when missing, and says where to look when it failed", () => {
    expect(card({ kind: "missing" }).report!().version).toMatchObject({
      name: "agent-desktop",
      state: "missing",
      action: "install",
    });
    const failed = card({
      kind: "failed",
      message: "registry.npmjs.org: no data arrived for 30 s",
      at: 0,
    }).report!();
    expect(failed.version).toMatchObject({
      state: "failed",
      action: "install",
      details: "registry.npmjs.org: no data arrived for 30 s",
      text: expect.stringContaining("Plugin Sources"),
      textZh: expect.stringContaining("插件源"),
    });
    expect(failed.version!.text).toContain("agent-desktop program path");
    expect(failed.version!.text).not.toContain("no data arrived");
    expect(failed.summary?.state).toBe("attention");
  });

  it("shows an install in progress as preparing, with its progress", () => {
    const report = card({
      kind: "installing",
      progress: { step: "download", received: 4, total: 16 },
      startedAt: 0,
    }).report!();
    expect(report.version).toMatchObject({ state: "preparing", progress: 0.25 });
    // The version element says it is preparing: no summary saying it again.
    expect(report.summary).toBeUndefined();
  });

  it("labels the checks in both languages, with the idle row and one recheck", () => {
    const probe: ProbeResult = {
      at: Date.now(),
      status: {
        ok: true,
        command: "status",
        data: { permissions: { accessibility: { state: "denied" } } },
      },
      windows: null,
      idle: {
        seconds: null,
        source: null,
        reason: "Wayland offers no way to read the input idle time",
      },
    };
    const report = card(
      {
        kind: "installed",
        installed: {
          version: "1.3.1",
          target: "darwin-arm64",
          dir: "/d",
          program: "/d/agent-desktop",
        },
      },
      { platform: "darwin", probe },
    ).report!();
    expect(report.version).toMatchObject({
      state: "installed",
      version: "1.3.1",
      platform: "darwin-arm64",
    });
    expect(report.recheck).toBe("check");
    const accessibility = report.checks!.find((c) => c.id === "accessibility")!;
    expect(accessibility).toMatchObject({
      label: "Accessibility",
      labelZh: "辅助功能",
      state: "action",
      action: "guide",
    });
    const idle = report.checks!.find((c) => c.id === "idle")!;
    expect(idle).toMatchObject({
      label: "User activity",
      labelZh: "用户活动",
      state: "unknown",
      details: "Wayland offers no way to read the input idle time",
    });
    expect(report.summary?.state).toBe("attention");
  });

  it("keeps the notices to what has no element once the host asks for the report", () => {
    const status = card({ kind: "missing" });
    const before = status.notices().map((n) => n.text);
    expect(before.some((t) => t.includes("is not installed"))).toBe(true);
    status.report!();
    const after = status.notices().map((n) => n.text);
    expect(after.some((t) => t.includes("is not installed"))).toBe(false);
    expect(after.some((t) => t.includes("Web App"))).toBe(true);
  });
});
