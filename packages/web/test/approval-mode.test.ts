/**
 * approval-mode.ts: which approval modes the composer's picker lists. An organization's
 * Session (`client: "org"`) runs with nobody watching — the server denies on the spot any call
 * its mode would hand to a person — so `always-ask` is left out there, as in the organization
 * settings. The one exception is a row that already stores it: the entry stays listed while it
 * is the current value, rather than the menu showing nothing selected. Every other Session
 * gets all four.
 */
import { describe, expect, it } from "vitest";
import { APPROVAL_MODES, approvalModeChoices } from "../src/features/chat/approval-mode";

describe("approvalModeChoices", () => {
  it("lists every mode for a Session the organization runtime did not open", () => {
    expect(APPROVAL_MODES).toEqual(["always-ask", "read-only", "allow-all", "deny-all"]);
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
