/**
 * What the composer's permission menu lists by the server's Sandbox switch: approval modes alone
 * while it is off, presets while it is on or unreported. An approval-mode pick carries no policy.
 */
import { describe, expect, it } from "vitest";
import type { ApprovalMode, SessionSandbox } from "@prismshadow/penguin-server/api";
import {
  BUILTIN_PRESETS,
  approvalModePick,
  draftSandboxAfter,
  permissionMenu,
  presetPick,
} from "../src/lib/permission-level";
import { APPROVAL_MODES, approvalModeChoices } from "../src/features/chat/approval-mode";

const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };
const ids = (sandbox: SessionSandbox, modes: readonly ApprovalMode[] = APPROVAL_MODES) =>
  permissionMenu(sandbox, modes, null).map((r) => (r.kind === "preset" ? r.preset.id : r.mode));

describe("the permission menu by the Sandbox switch", () => {
  it("lists the approval modes alone while the switch is off, always-ask withheld from an org", () => {
    const off = { ...UNCONFINED, switchOn: false };
    expect(permissionMenu(off, APPROVAL_MODES, null)).toEqual(
      APPROVAL_MODES.map((mode) => ({ kind: "approval", mode })),
    );
    expect(ids(off, approvalModeChoices("org", "allow-all"))).toEqual([
      "read-only",
      "allow-all",
      "deny-all",
    ]);
  });

  it("lists the menu's presets in table order while the switch is on or unreported", () => {
    const inMenu = BUILTIN_PRESETS.filter((p) => p.enabled).map((p) => p.id);
    expect(ids({ ...UNCONFINED, switchOn: true })).toEqual(inMenu);
    expect(ids(UNCONFINED)).toEqual(inMenu);
    const preset = (id: string, enabled: boolean) => ({
      ...BUILTIN_PRESETS[0]!,
      id,
      name: id,
      enabled,
    });
    const presets = [preset("mine", true), preset("read-only", true), preset("denied-all", false)];
    expect(ids({ ...UNCONFINED, switchOn: true, presets })).toEqual(["mine", "read-only"]);
  });
});

describe("what a pick from the menu carries", () => {
  it("an approval-mode pick sends the mode alone and leaves a draft's sandbox as it was", () => {
    const pick = approvalModePick("always-ask");
    expect(pick).toEqual({ approvalMode: "always-ask" });
    expect("sandbox" in pick).toBe(false);
    expect(draftSandboxAfter({}, pick)).toEqual({});
    expect(draftSandboxAfter({ mode: "read-only" }, pick)).toEqual({ mode: "read-only" });
  });

  it("a preset pick sends its approval mode and its policy together", () => {
    const readOnly = BUILTIN_PRESETS.find((p) => p.id === "read-only")!;
    const { approvalMode, mode, network } = readOnly;
    const pick = presetPick(readOnly);
    expect(pick).toEqual({ approvalMode, sandbox: { mode, network } });
    expect(draftSandboxAfter({}, pick)).toEqual({ mode, network });
  });
});
