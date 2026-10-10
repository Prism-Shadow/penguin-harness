/**
 * Which approval modes the composer's picker lists (features/chat/approval-mode.ts).
 *
 * - Every Session the organization runtime did not open (web, cli, or a row from before the
 *   column existed) gets every mode.
 * - An organization's Session runs with nobody watching, so always-ask is left out there...
 * - ...except while the row already stores it: it stays listed in its usual place rather than
 *   the menu showing nothing selected, and goes once another mode is picked.
 */
import { describe, expect, it } from "vitest";
import { APPROVAL_MODES, approvalModeChoices } from "../src/features/chat/approval-mode";

describe("approvalModeChoices", () => {
  it("lists every mode for a Session the organization runtime did not open", () => {
    // `undefined`: a row from before the column existed, which reads as a web Session.
    for (const client of ["web", "cli", undefined] as const) {
      expect(approvalModeChoices(client, "allow-all")).toEqual(APPROVAL_MODES);
      expect(approvalModeChoices(client, "always-ask")).toEqual(APPROVAL_MODES);
    }
  });

  it("leaves always-ask out for an organization's Session", () => {
    for (const current of ["read-only", "allow-all", "deny-all"] as const) {
      expect(approvalModeChoices("org", current)).toEqual(["read-only", "allow-all", "deny-all"]);
    }
  });

  it("keeps always-ask listed, in its usual place, while an organization's Session stores it", () => {
    expect(approvalModeChoices("org", "always-ask")).toEqual([
      "always-ask",
      "read-only",
      "allow-all",
      "deny-all",
    ]);
    // Once another mode is picked, it is no longer offered.
    expect(approvalModeChoices("org", "deny-all")).not.toContain("always-ask");
  });
});
