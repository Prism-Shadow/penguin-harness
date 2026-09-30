/**
 * The composer's permission level (lib/permission-level.ts): how much the Agent may do on its
 * own, in one mark.
 *
 * - The level is all only when nothing holds the Agent back; any approval, network or
 *   sandbox limit makes it partial.
 * - It is read-only when commands cannot write, and off when every call is denied.
 * - Each level wears its own glyph, so the level never depends on colour alone.
 */
import { describe, expect, it } from "vitest";
import type { ApprovalMode, SessionSandbox } from "@prismshadow/penguin-server/api";
import {
  BUILTIN_PRESETS,
  PERMISSION_LEVEL_GLYPH,
  firstUnavailableBackend,
  fsModeBlock,
  matchPreset,
  menuPresets,
  networkBlock,
  permissionLevel,
  presetBlock,
  presetEffects,
  presetsOf,
} from "../src/lib/permission-level";
import { APPROVAL_MODES, approvalModeChoices } from "../src/features/chat/approval-mode";

const FULL: SessionSandbox = { mode: "danger-full-access", network: "open" };

describe("which levels the composer lets a person pick", () => {
  const NO_BACKEND: SessionSandbox = {
    ...FULL,
    confinementSupported: false,
    noNetworkSupported: false,
    localNetworkSupported: false,
  };

  it("with no backend installed, every level short of full access is marked not installed", () => {
    expect(fsModeBlock(NO_BACKEND, "read-only")).toBe("no-backend");
    expect(fsModeBlock(NO_BACKEND, "workspace-write")).toBe("no-backend");
    expect(fsModeBlock(NO_BACKEND, "danger-full-access")).toBeNull();
    expect(networkBlock(NO_BACKEND, "none")).toBe("no-backend");
    expect(networkBlock(NO_BACKEND, "local")).toBe("no-backend");
    expect(networkBlock(NO_BACKEND, "open")).toBeNull();
  });

  it("with an enabled backend that failed its check, those levels are unavailable, with its reason", () => {
    const failed: SessionSandbox = {
      ...NO_BACKEND,
      unavailableBackends: [
        { name: "penguin-wsl", reason: "the sandbox distro is not set up" },
        { name: "penguin-dsh", reason: "cannot load" },
      ],
    };
    expect(fsModeBlock(failed, "read-only")).toBe("unavailable");
    expect(fsModeBlock(failed, "workspace-write")).toBe("unavailable");
    expect(fsModeBlock(failed, "danger-full-access")).toBeNull();
    expect(networkBlock(failed, "none")).toBe("unavailable");
    expect(networkBlock(failed, "local")).toBe("unavailable");
    expect(networkBlock(failed, "open")).toBeNull();
    expect(firstUnavailableBackend(failed)).toEqual({
      name: "penguin-wsl",
      reason: "the sandbox distro is not set up",
    });
    // An empty list is the not-installed case.
    const none: SessionSandbox = { ...NO_BACKEND, unavailableBackends: [] };
    expect(fsModeBlock(none, "read-only")).toBe("no-backend");
    expect(firstUnavailableBackend(none)).toBeNull();
    // A mounted backend wins: a second one failing does not grey out what the first enforces.
    const mounted: SessionSandbox = { ...failed, confinementSupported: true };
    expect(fsModeBlock(mounted, "read-only")).toBeNull();
  });

  it("with a filesystem-only backend, confinement is open and only the network levels are not", () => {
    const fsOnly: SessionSandbox = { ...NO_BACKEND, confinementSupported: true };
    expect(fsModeBlock(fsOnly, "read-only")).toBeNull();
    expect(fsModeBlock(fsOnly, "workspace-write")).toBeNull();
    expect(networkBlock(fsOnly, "none")).toBe("none-unsupported");
    expect(networkBlock(fsOnly, "local")).toBe("local-unsupported");
  });

  it("with a full backend, nothing is blocked", () => {
    const full: SessionSandbox = {
      ...FULL,
      confinementSupported: true,
      noNetworkSupported: true,
      localNetworkSupported: true,
    };
    for (const mode of ["read-only", "workspace-write", "danger-full-access"] as const) {
      expect(fsModeBlock(full, mode)).toBeNull();
    }
    for (const network of ["none", "local", "open"] as const) {
      expect(networkBlock(full, network)).toBeNull();
    }
  });

  it("a server that does not report the flags is not second-guessed, except for local", () => {
    expect(fsModeBlock(FULL, "read-only")).toBeNull();
    expect(networkBlock(FULL, "none")).toBeNull();
    expect(networkBlock(FULL, "local")).toBe("local-unsupported");
  });
});

describe("permission level", () => {
  it("is all only when nothing holds the Agent back", () => {
    expect(permissionLevel("allow-all", FULL)).toBe("all");
    expect(permissionLevel("always-ask", FULL)).toBe("partial");
    expect(permissionLevel("read-only", FULL)).toBe("partial");
    expect(permissionLevel("allow-all", { ...FULL, network: "none" })).toBe("partial");
    expect(permissionLevel("allow-all", { ...FULL, mode: "workspace-write" })).toBe("partial");
  });

  it("is read-only when commands cannot write, and off when every call is denied", () => {
    expect(permissionLevel("allow-all", { mode: "read-only", network: "open" })).toBe("read-only");
    expect(permissionLevel("deny-all", FULL)).toBe("off");
    expect(permissionLevel("deny-all", { mode: "read-only", network: "none" })).toBe("off");
  });

  it("draws each level with its own mark, so the level never depends on colour alone", () => {
    const glyphs = Object.values(PERMISSION_LEVEL_GLYPH);
    expect(glyphs).toHaveLength(4);
    expect(new Set(glyphs).size).toBe(4);
  });
});

describe("the composer's presets", () => {
  const byId = (id: string) => BUILTIN_PRESETS.find((p) => p.id === id)!;

  it("names a level by the first matching row, disabled rows included, and by none when no row matches", () => {
    expect(matchPreset(BUILTIN_PRESETS, "allow-all", FULL)?.id).toBe("full-access");
    expect(matchPreset(BUILTIN_PRESETS, "always-ask", FULL)?.id).toBe("always-ask");
    expect(matchPreset(BUILTIN_PRESETS, "allow-all", { ...FULL, mode: "read-only" })?.id).toBe(
      "read-only",
    );
    // Not in the menu, still its name.
    expect(matchPreset(BUILTIN_PRESETS, "deny-all", FULL)?.id).toBe("denied-all");
    // A level set from the full settings is custom, never rounded to a row.
    expect(matchPreset(BUILTIN_PRESETS, "allow-all", { ...FULL, network: "none" })).toBeNull();
    expect(matchPreset(BUILTIN_PRESETS, "read-only", FULL)).toBeNull();
    // Two rows holding the same values: table order decides.
    const twice = [
      { ...byId("always-ask"), id: "first" },
      { ...byId("always-ask"), id: "second", enabled: false },
    ];
    expect(matchPreset(twice, "always-ask", FULL)?.id).toBe("first");
    expect(matchPreset(twice.slice().reverse(), "always-ask", FULL)?.id).toBe("second");
  });

  it("offers the server's table when it reports one, and the built-in table when it does not", () => {
    expect(presetsOf(FULL)).toBe(BUILTIN_PRESETS);
    const renamed = [{ ...byId("full-access"), name: "Anything goes" }];
    expect(presetsOf({ ...FULL, presets: renamed })).toBe(renamed);
    // The built-in menu is the four common presets; the other two start out of it.
    expect(BUILTIN_PRESETS.filter((p) => p.enabled).map((p) => p.id)).toEqual([
      "full-access",
      "always-ask",
      "workspace-write",
      "read-only",
    ]);
  });

  it("offers no preset whose approval mode the Session may not be given, except the current one", () => {
    const ids = (modes: readonly ApprovalMode[], current: string | null) =>
      menuPresets(BUILTIN_PRESETS, modes, current === null ? null : byId(current)).map((p) => p.id);
    // An ordinary Session: every enabled row, in table order.
    expect(ids(APPROVAL_MODES, "full-access")).toEqual([
      "full-access",
      "always-ask",
      "workspace-write",
      "read-only",
    ]);
    // An organization's Session is never offered always-ask, as a mode or through a preset.
    expect(ids(approvalModeChoices("org", "allow-all"), "full-access")).toEqual([
      "full-access",
      "workspace-write",
      "read-only",
    ]);
    expect(ids(approvalModeChoices("org", "allow-all"), null)).not.toContain("always-ask");
    // Unless it is the current preset: listed in its usual place, ticked, until another is picked.
    expect(ids(approvalModeChoices("org", "always-ask"), "always-ask")).toEqual([
      "full-access",
      "always-ask",
      "workspace-write",
      "read-only",
    ]);
    // The current preset is kept by the helper itself, whatever list it is handed.
    expect(ids(["allow-all"], "always-ask")).toEqual([
      "full-access",
      "always-ask",
      "workspace-write",
      "read-only",
    ]);
    // A disabled row stays out of the menu even when it is the current preset.
    expect(ids(APPROVAL_MODES, "denied-all")).not.toContain("denied-all");
  });

  it("greys out a preset this server cannot enforce, in each of the four cases", () => {
    const blocks = (sandbox: SessionSandbox) =>
      Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.id, presetBlock(sandbox, p)]));
    const neverBlocked = { "full-access": null, "always-ask": null, "denied-all": null };
    // No backend: every preset that confines is not installed.
    const none: SessionSandbox = {
      ...FULL,
      confinementSupported: false,
      noNetworkSupported: false,
      localNetworkSupported: false,
      unavailableBackends: [],
    };
    expect(blocks(none)).toEqual({
      ...neverBlocked,
      "workspace-write": "no-backend",
      "read-only": "no-backend",
      "workspace-write-ask": "no-backend",
    });
    // A filesystem-only backend enforces the default table whole; cutting the network it cannot.
    const fsOnly: SessionSandbox = { ...none, confinementSupported: true };
    expect(Object.values(blocks(fsOnly)).every((b) => b === null)).toBe(true);
    expect(presetBlock(fsOnly, { mode: "read-only", network: "none" })).toBe("none-unsupported");
    // A full backend: nothing is blocked, the local level included.
    const full: SessionSandbox = {
      ...FULL,
      confinementSupported: true,
      noNetworkSupported: true,
      localNetworkSupported: true,
    };
    expect(presetBlock(full, { mode: "workspace-write", network: "local" })).toBeNull();
    // An older server that does not report the flags: nothing second-guessed but local.
    expect(Object.values(blocks(FULL)).every((b) => b === null)).toBe(true);
    expect(presetBlock(FULL, { mode: "read-only", network: "local" })).toBe("local-unsupported");
  });

  it("says what a preset blocks and allows, from its three values", () => {
    expect(presetEffects(byId("full-access"))).toEqual({
      blocks: [],
      allows: ["files-everywhere", "network-open", "calls-unasked"],
    });
    expect(presetEffects(byId("always-ask"))).toEqual({
      blocks: ["unasked-calls"],
      allows: ["files-everywhere", "network-open"],
    });
    expect(presetEffects(byId("workspace-write-ask"))).toEqual({
      blocks: ["write-outside-workspace", "unasked-calls"],
      allows: ["files-in-workspace", "network-open"],
    });
    expect(presetEffects(byId("denied-all")).blocks).toEqual(["every-call"]);
    expect(
      presetEffects({ mode: "read-only", network: "local", approvalMode: "read-only" }),
    ).toEqual({
      blocks: ["write-anywhere", "network-beyond-localhost", "unasked-writes"],
      allows: ["read-files", "localhost", "reads-unasked"],
    });
    expect(presetEffects({ ...byId("full-access"), network: "none" }).blocks).toEqual(["network"]);
  });
});
