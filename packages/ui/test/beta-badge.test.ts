/**
 * BetaBadge (src/components/feedback/beta-badge/beta-badge.tsx): the caller's words on the
 * smallest text rung, in the muted ink rather than a tone. How the work-mode switch hangs it is
 * the web app's `company-beta` test.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { BetaBadge } from "../src/components/feedback/beta-badge/beta-badge";
import { renderStatic } from "../src/testing";

describe("BetaBadge", () => {
  it("says the caller's label, with the tooltip when there is one", () => {
    const html = renderStatic(createElement(BetaBadge, { label: "Beta", title: "In beta" }));
    expect(html).toContain('data-tooltip="In beta"');
    expect(html).toContain(">Beta</span>");
    expect(renderStatic(createElement(BetaBadge, { label: "Beta" }))).not.toContain("data-tooltip");
  });
});
