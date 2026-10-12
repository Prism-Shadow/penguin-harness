/**
 * The non-admin ceiling on a Session's sandbox: a non-admin may tighten but never loosen past the
 * server's settings; an admin may. The composer's `aboveCeiling` mark is the same comparison.
 */
import { describe, expect, it } from "vitest";
import type { SandboxSettings } from "@prismshadow/penguin-core/plugin";
import { aboveSandboxCeiling } from "../src/services/sandbox-ceiling.js";
import { applySandboxPick, sessionSandboxOf } from "../src/services/session-service.js";

describe("the non-admin ceiling on a Session's sandbox", () => {
  const settings: SandboxSettings = {
    mode: "workspace-write",
    network: "none",
    maskPaths: ["/secret"],
    writableTemp: false,
  };
  const local: SandboxSettings = { mode: "workspace-write", network: "local" };

  it.each([
    ["danger-full-access", "open", "mode"],
    ["read-only", "open", "network"],
    ["workspace-write", "local", null],
    ["read-only", "none", null],
  ] as const)("ranks %s/%s against workspace-write/local: %s", (mode, network, wider) => {
    expect(
      aboveSandboxCeiling({ mode, network }, { mode: "workspace-write", network: "local" }),
    ).toBe(wider);
  });

  it.each([
    [settings, { mode: "danger-full-access" }],
    [settings, { network: "open" }],
    [settings, { network: "local" }],
    [local, { network: "open" }],
  ] as const)("a non-admin cannot loosen %j by %j", (base, pick) => {
    expect(() => applySandboxPick(base, pick, base, false, true)).toThrow(/Only an administrator/);
  });

  it("refuses the local level where no backend supports it", () => {
    expect(() => applySandboxPick(settings, { network: "local" }, settings, true)).toThrow(
      /localhost/,
    );
  });

  it("a non-admin may tighten and come back, and pick local under open settings", () => {
    const tightened = applySandboxPick(settings, { mode: "read-only" }, settings, false);
    expect(applySandboxPick(tightened, { mode: "workspace-write" }, settings, false).mode).toBe(
      "workspace-write",
    );
    expect(applySandboxPick(local, { network: "none" }, local, false, true).network).toBe("none");
    const open: SandboxSettings = { mode: "workspace-write" };
    const picked = applySandboxPick(open, { network: "local" }, open, false, true);
    expect(sessionSandboxOf(picked, ["fs-write", "network", "network-local"])).toMatchObject({
      network: "local",
      localNetworkSupported: true,
    });
  });

  it("an admin may go past the settings", () => {
    const opened = applySandboxPick(
      settings,
      { mode: "danger-full-access", network: "open" },
      settings,
      true,
    );
    expect(opened.mode).toBe("danger-full-access");
    expect(opened.network).toBeUndefined();
  });
});
