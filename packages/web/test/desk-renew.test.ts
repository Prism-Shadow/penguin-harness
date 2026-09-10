/**
 * desk-renew.ts unit tests: what a desk-renewal confirm sends — a renewal alone when the
 * prefilled workspace is untouched, the workspace write first when it changed, and a refusal
 * when the required field was emptied.
 */
import { describe, expect, it } from "vitest";
import { deskRenewPlan } from "../src/features/company/desk-renew";

describe("deskRenewPlan", () => {
  it("sends no workspace write when the prefilled spec is left alone", () => {
    expect(deskRenewPlan("hr", "hr")).toEqual({ valid: true, workspace: null });
    // Padding is not a change: the field is prefilled, and a stray space must not rewrite the chart.
    expect(deskRenewPlan("hr", "  hr  ")).toEqual({ valid: true, workspace: null });
    expect(deskRenewPlan(".", ".")).toEqual({ valid: true, workspace: null });
  });

  it("sends the trimmed spec when it changed", () => {
    expect(deskRenewPlan("hr", "hr/2026")).toEqual({ valid: true, workspace: "hr/2026" });
    expect(deskRenewPlan(".", " /srv/shared ")).toEqual({ valid: true, workspace: "/srv/shared" });
    // Case matters: a directory name is the file system's, not ours to fold.
    expect(deskRenewPlan("hr", "HR")).toEqual({ valid: true, workspace: "HR" });
  });

  it("refuses an emptied field instead of falling back to the shared workspace", () => {
    expect(deskRenewPlan("hr", "")).toEqual({ valid: false, workspace: null });
    expect(deskRenewPlan("hr", "   ")).toEqual({ valid: false, workspace: null });
  });
});
