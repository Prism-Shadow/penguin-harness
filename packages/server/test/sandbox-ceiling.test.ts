/**
 * The non-admin ceiling on a Session's sandbox: a non-admin may tighten a Session's policy but
 * never give it more file or network access than the server's settings; an admin may. The
 * composer's `aboveCeiling` mark is the same comparison (`aboveSandboxCeiling`), so a row it
 * greys out is exactly a pick the server refuses.
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

  it("names the dimension a level is wider in, the file mode first, and none within", () => {
    const ceiling = { mode: "workspace-write", network: "local" } as const;
    expect(aboveSandboxCeiling({ mode: "danger-full-access", network: "open" }, ceiling)).toBe(
      "mode",
    );
    expect(aboveSandboxCeiling({ mode: "read-only", network: "open" }, ceiling)).toBe("network");
    expect(aboveSandboxCeiling({ mode: "workspace-write", network: "local" }, ceiling)).toBeNull();
    expect(aboveSandboxCeiling({ mode: "read-only", network: "none" }, ceiling)).toBeNull();
  });

  it("a non-admin cannot loosen past the server's settings, in either dimension", () => {
    expect(() =>
      applySandboxPick(settings, { mode: "danger-full-access" }, settings, false),
    ).toThrow(/Only an administrator/);
    expect(() => applySandboxPick(settings, { network: "open" }, settings, false)).toThrow(
      /Only an administrator/,
    );
  });

  it("the local level is refused where no backend supports it, and ranks between none and open", () => {
    expect(() => applySandboxPick(settings, { network: "local" }, settings, true)).toThrow(
      /localhost/,
    );
    const open: SandboxSettings = { mode: "workspace-write" };
    const local = applySandboxPick(open, { network: "local" }, open, false, true);
    expect(local.network).toBe("local");
    expect(sessionSandboxOf(local, ["fs-write", "network", "network-local"])).toEqual({
      mode: "workspace-write",
      network: "local",
      confinementSupported: true,
      noNetworkSupported: true,
      localNetworkSupported: true,
      unavailableBackends: [],
    });
    // Under settings of "local", a non-admin may cut the network but not open it.
    const localDefaults: SandboxSettings = { mode: "workspace-write", network: "local" };
    expect(
      applySandboxPick(localDefaults, { network: "none" }, localDefaults, false, true).network,
    ).toBe("none");
    expect(() =>
      applySandboxPick(localDefaults, { network: "open" }, localDefaults, false, true),
    ).toThrow(/Only an administrator/);
    // Under settings of "none", "local" is already looser.
    expect(() => applySandboxPick(settings, { network: "local" }, settings, false, true)).toThrow(
      /Only an administrator/,
    );
  });

  it("a non-admin who tightened may come back to the settings; an admin may go past them", () => {
    const tightened = applySandboxPick(settings, { mode: "read-only" }, settings, false);
    expect(applySandboxPick(tightened, { mode: "workspace-write" }, settings, false).mode).toBe(
      "workspace-write",
    );
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
