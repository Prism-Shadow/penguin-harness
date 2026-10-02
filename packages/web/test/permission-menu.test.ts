/**
 * What the composer's permission menu lists, by the server's Sandbox switch.
 *
 * - Given the switch off, the menu lists the approval modes the Session may be given, in the
 *   picker's order, and no preset — an organization's Session still does not get always-ask.
 * - Given the switch on, or a server that does not report it, the menu lists the presets in
 *   the menu, as before.
 */
import { describe, expect, it } from "vitest";
import type { SessionSandbox } from "@prismshadow/penguin-server/api";
import { BUILTIN_PRESETS, permissionMenu } from "../src/lib/permission-level";
import { APPROVAL_MODES, approvalModeChoices } from "../src/features/chat/approval-mode";

const UNCONFINED: SessionSandbox = { mode: "danger-full-access", network: "open" };

describe("the permission menu by the Sandbox switch", () => {
  it("lists the approval modes alone while the switch is off", () => {
    const rows = permissionMenu({ ...UNCONFINED, switchOn: false }, APPROVAL_MODES, null);
    expect(rows).toEqual(APPROVAL_MODES.map((mode) => ({ kind: "approval", mode })));
    // An organization's Session is not offered always-ask here either.
    const org = permissionMenu(
      { ...UNCONFINED, switchOn: false },
      approvalModeChoices("org", "allow-all"),
      null,
    );
    expect(org.map((r) => (r.kind === "approval" ? r.mode : r.kind))).toEqual([
      "read-only",
      "allow-all",
      "deny-all",
    ]);
  });

  it("lists the presets in the menu while the switch is on, and when the server does not say", () => {
    const inMenu = BUILTIN_PRESETS.filter((p) => p.enabled).map((p) => p.id);
    for (const sandbox of [{ ...UNCONFINED, switchOn: true }, UNCONFINED]) {
      const rows = permissionMenu(sandbox, APPROVAL_MODES, null);
      expect(rows.map((r) => (r.kind === "preset" ? r.preset.id : r.kind))).toEqual(inMenu);
    }
  });

  it("lists a server's presets in its order, an added one included and unpinned ones left out", () => {
    const preset = (id: string, enabled: boolean) => ({
      id,
      name: id,
      enabled,
      mode: "read-only" as const,
      network: "open" as const,
      approvalMode: "allow-all" as const,
    });
    const sandbox: SessionSandbox = {
      ...UNCONFINED,
      switchOn: true,
      presets: [preset("mine", true), preset("read-only", true), preset("denied-all", false)],
    };
    const rows = permissionMenu(sandbox, APPROVAL_MODES, null);
    expect(rows.map((r) => (r.kind === "preset" ? r.preset.id : r.kind))).toEqual([
      "mine",
      "read-only",
    ]);
  });
});
