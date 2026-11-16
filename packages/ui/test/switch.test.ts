/**
 * Switch (src/components/forms/switch/switch.tsx): a native button with the switch role, painted
 * from the theme's switch tokens, its geometry in spacing units, its hint in the shared tooltip.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Switch } from "../src/components/forms/switch/switch";
import { renderStatic } from "../src/testing";

const render = (checked: boolean, extra: Record<string, unknown> = {}) =>
  renderStatic(createElement(Switch, { checked, onChange: () => {}, ...extra }));

/** The class tokens of the knob: the sized span inside the button. */

describe("Switch", () => {
  it("is a button with the switch role and its state", () => {
    expect(render(true)).toMatch(/^<button type="button" role="switch" aria-checked="true"/);
    expect(render(false)).toContain('aria-checked="false"');
    expect(render(false, { disabled: true })).toContain('disabled=""');
  });

  it("shows its hint through the tooltip layer, never a native title", () => {
    const html = render(false, { title: "Notify when done", "aria-label": "Notify" });
    expect(html).toContain('data-tooltip="Notify when done"');
    expect(html).toContain('aria-label="Notify"');
    expect(html).not.toContain("title=");
  });
});
