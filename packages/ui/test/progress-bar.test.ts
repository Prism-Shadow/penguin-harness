/**
 * ProgressBar (src/components/feedback/progress-bar/progress-bar.tsx): a named progress bar whose
 * determinate fill moves on the theme's layout motion, and whose indeterminate segment pulses as a
 * live signal and reports no value.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "../src/components/feedback/progress-bar/progress-bar";
import { classTokens, renderStatic } from "../src/testing";

describe("ProgressBar", () => {
  it("names itself and reports a clamped value, the fill on the layout motion", () => {
    const html = renderStatic(
      createElement(ProgressBar, { value: 140, label: "Download progress", tone: "danger" }),
    );
    expect(html).toContain('role="progressbar"');
    expect(html).toContain('aria-label="Download progress"');
    expect(html).toContain('aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"');
    expect(html).toContain('data-layout-motion=""');
    expect(html).toContain("width:100%");
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-line-muted", "bg-tone-danger-emphasis"]),
    );
  });

  it("reports no value while indeterminate, and pulses through the live hook", () => {
    const html = renderStatic(
      createElement(ProgressBar, { indeterminate: true, label: "Download progress" }),
    );
    expect(html).not.toContain("aria-valuenow");
    expect(html).not.toContain("data-layout-motion");
    expect(html).toContain('data-live="bar"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-accent", "w-1/3", "ui-live", "animate-pulse"]),
    );
  });

  it("passes the caller's tooltip through to the bar", () => {
    // Not an object literal at the call, so the data attribute is not an excess property.
    const props = { value: 40, label: "Spend", "data-tooltip": "$4 of $10" };
    const html = renderStatic(createElement(ProgressBar, props));
    expect(html).toContain('data-tooltip="$4 of $10"');
  });
});
