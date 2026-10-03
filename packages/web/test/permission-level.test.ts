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
  const MENU = ["full-access", "always-ask", "workspace-write", "read-only"];

  // A level set from the full settings is custom (null), never rounded to a row; disabled rows still name it.
  it.each([
    ["allow-all", {}, "full-access"],
    ["always-ask", {}, "always-ask"],
    ["allow-all", { mode: "read-only" }, "read-only"],
    ["deny-all", {}, "denied-all"],
    ["allow-all", { network: "none" }, undefined],
    ["read-only", {}, undefined],
  ] as const)("names %s over %o as %s", (approval, over, id) => {
    expect(matchPreset(BUILTIN_PRESETS, approval, { ...FULL, ...over })?.id).toBe(id);
  });

  it("names a level held by two rows by table order", () => {
    const twice = [
      { ...byId("always-ask"), id: "first" },
      { ...byId("always-ask"), id: "second", enabled: false },
    ];
    expect(matchPreset(twice, "always-ask", FULL)?.id).toBe("first");
    expect(matchPreset(twice.slice().reverse(), "always-ask", FULL)?.id).toBe("second");
  });

  it("offers the server's table when it reports one, else the built-in four", () => {
    const renamed = [{ ...byId("full-access"), name: "Anything goes" }];
    expect(presetsOf({ ...FULL, presets: renamed })).toBe(renamed);
    expect(presetsOf(FULL)).toBe(BUILTIN_PRESETS);
    expect(BUILTIN_PRESETS.filter((p) => p.enabled).map((p) => p.id)).toEqual(MENU);
  });

  // An organization's Session is never offered always-ask, unless it is the current preset;
  // a disabled row stays out even when current.
  const org = approvalModeChoices("org", "allow-all");
  it.each([
    [APPROVAL_MODES, "full-access", MENU],
    [org, "full-access", MENU.filter((id) => id !== "always-ask")],
    [org, null, MENU.filter((id) => id !== "always-ask")],
    [["allow-all"] as ApprovalMode[], "always-ask", MENU],
    [APPROVAL_MODES, "denied-all", MENU],
  ])("menu for modes %j, current %s", (modes, current, expected) => {
    const cur = current === null ? null : byId(current);
    expect(menuPresets(BUILTIN_PRESETS, modes, cur).map((p) => p.id)).toEqual(expected);
  });

  it("greys out a preset this server cannot enforce", () => {
    const blocks = (sandbox: SessionSandbox) =>
      Object.fromEntries(BUILTIN_PRESETS.map((p) => [p.id, presetBlock(sandbox, p)]));
    const none: SessionSandbox = {
      ...FULL,
      confinementSupported: false,
      noNetworkSupported: false,
      localNetworkSupported: false,
      unavailableBackends: [],
    };
    // No backend: every confining preset; filesystem-only: only the network cut.
    expect(blocks(none)).toMatchObject({ "full-access": null, "read-only": "no-backend" });
    expect(blocks(none)["workspace-write-ask"]).toBe("no-backend");
    const fsOnly: SessionSandbox = { ...none, confinementSupported: true };
    expect(Object.values(blocks(fsOnly)).every((b) => b === null)).toBe(true);
    expect(presetBlock(fsOnly, { mode: "read-only", network: "none" })).toBe("none-unsupported");
    const all = { ...fsOnly, noNetworkSupported: true, localNetworkSupported: true };
    expect(presetBlock(all, { mode: "workspace-write", network: "local" })).toBeNull();
    // An older server without the flags: nothing second-guessed but local.
    expect(Object.values(blocks(FULL)).every((b) => b === null)).toBe(true);
    expect(presetBlock(FULL, { mode: "read-only", network: "local" })).toBe("local-unsupported");
  });

  it("greys out every preset, full access included, when the policy masks paths no backend here can", () => {
    const blocks = (sandbox: SessionSandbox) =>
      new Set(BUILTIN_PRESETS.map((p) => presetBlock(sandbox, p)));
    // The DSH adaptor alone: files confined, masked paths not — every command would be refused.
    const fsOnly: SessionSandbox = {
      ...FULL,
      confinementSupported: true,
      noNetworkSupported: false,
      localNetworkSupported: false,
      maskPathsSupported: false,
      masksPaths: true,
    };
    expect(blocks(fsOnly)).toEqual(new Set(["mask-unsupported"]));
    // Nothing mounted at all: the reason is that, not the masks.
    expect(blocks({ ...fsOnly, confinementSupported: false, unavailableBackends: [] })).toEqual(
      new Set(["no-backend"]),
    );
    // A backend that masks, or a policy that masks nothing, or a server not reporting it: no block.
    expect(blocks({ ...fsOnly, maskPathsSupported: true })).toEqual(new Set([null]));
    expect(blocks({ ...fsOnly, masksPaths: undefined })).toEqual(new Set([null]));
    expect(blocks({ ...FULL, masksPaths: true })).toEqual(new Set([null]));
  });

  it("greys out a preset above the ceiling for a non-admin, never for an admin or the current one", () => {
    const presets = BUILTIN_PRESETS.map((p) =>
      p.mode === "danger-full-access" ? { ...p, aboveCeiling: true as const } : p,
    );
    const sandbox: SessionSandbox = {
      mode: "workspace-write",
      network: "open",
      confinementSupported: true,
      presets,
    };
    const blocked = (isAdmin: boolean, currentId: string | null) =>
      presets
        .filter((p) => presetBlock(sandbox, p, { isAdmin, current: byId(currentId ?? "") ?? null }))
        .map((p) => p.id);
    expect(presetBlock(sandbox, presets[0]!, { isAdmin: false, current: null })).toBe(
      "above-ceiling",
    );
    expect(blocked(false, "workspace-write")).toEqual(["full-access", "always-ask", "denied-all"]);
    expect(blocked(true, "workspace-write")).toEqual([]);
    expect(blocked(false, "always-ask")).toEqual(["full-access", "denied-all"]);
    // Unenforceable says that first, whoever picks it.
    const none = { ...sandbox, confinementSupported: false };
    expect(presetBlock(none, byId("read-only"), { isAdmin: true, current: null })).toBe(
      "no-backend",
    );
  });

  it.each([
    [byId("full-access"), [], ["files-everywhere", "network-open", "calls-unasked"]],
    [byId("always-ask"), ["unasked-calls"], ["files-everywhere", "network-open"]],
    [
      byId("workspace-write-ask"),
      ["write-outside-workspace", "unasked-calls"],
      ["files-in-workspace", "network-open"],
    ],
    [
      { mode: "read-only", network: "local", approvalMode: "read-only" } as const,
      ["write-anywhere", "network-beyond-localhost", "unasked-writes"],
      ["read-files", "localhost", "reads-unasked"],
    ],
  ])("says what %o blocks and allows", (preset, blocks, allows) => {
    expect(presetEffects(preset)).toEqual({ blocks, allows });
  });

  it("says denied-all blocks every call and a closed network blocks the network", () => {
    expect(presetEffects(byId("denied-all")).blocks).toEqual(["every-call"]);
    expect(presetEffects({ ...byId("full-access"), network: "none" }).blocks).toEqual(["network"]);
  });
});
