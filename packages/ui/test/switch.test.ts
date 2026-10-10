/**
 * Switch (src/components/forms/switch/switch.tsx): a native button with the switch role, painted
 * from the theme's switch tokens, its geometry in spacing units, its hint in the shared tooltip.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Switch } from "../src/components/forms/switch/switch";
import { classTokens, renderStatic } from "../src/testing";

const render = (checked: boolean, extra: Record<string, unknown> = {}) =>
  renderStatic(createElement(Switch, { checked, onChange: () => {}, ...extra }));

/** The class tokens of the knob: the sized span inside the button. */
const knob = (html: string) => classTokens(/<span class="size-4[^>]*>/.exec(html)?.[0] ?? "");

describe("Switch", () => {
  it("is a button with the switch role and its state", () => {
    expect(render(true)).toMatch(/^<button type="button" role="switch" aria-checked="true"/);
    expect(render(false)).toContain('aria-checked="false"');
    expect(render(false, { disabled: true })).toContain('disabled=""');
  });

  it("paints each track and knob from the theme's switch tokens", () => {
    const on = render(true);
    const off = render(false);
    expect(classTokens(on)).toContain("bg-accent");
    expect(knob(on)).toContain("bg-switch-knob-on");
    expect(classTokens(off)).toContain("bg-switch-track");
    expect(knob(off)).toEqual(
      expect.arrayContaining(["bg-switch-knob", "border-switch-knob-line"]),
    );
  });

  it("keeps its geometry in spacing units, and moves the knob by the theme's layout motion", () => {
    const on = render(true);
    const off = render(false);
    expect(classTokens(on)).toEqual(expect.arrayContaining(["h-5", "w-9", "px-0.5", "size-4"]));
    // The knob sits after a spacer column that grows from nothing to the rest of the track.
    const columns = (html: string) => /data-layout-motion="true" class="([^"]*)"/.exec(html)?.[1];
    expect(columns(off)).toContain("grid-cols-[0fr_auto]");
    expect(columns(on)).toContain("grid-cols-[1fr_auto]");
    // The component itself transitions colour only: no transform, no size of its own.
    expect(classTokens(on).filter((token) => token.startsWith("transition-"))).toEqual([
      "transition-colors",
    ]);
    expect(classTokens(on).some((token) => token.startsWith("translate-"))).toBe(false);
  });

  it("shows its hint through the tooltip layer, never a native title", () => {
    const html = render(false, { title: "Notify when done", "aria-label": "Notify" });
    expect(html).toContain('data-tooltip="Notify when done"');
    expect(html).toContain('aria-label="Notify"');
    expect(html).not.toContain("title=");
  });
});
