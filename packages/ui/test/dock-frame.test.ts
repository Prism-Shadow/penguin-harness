/**
 * DockFrame (src/components/shell/dock-frame/dock-frame.tsx): a dock that hides at size 0
 * rather than unmounting, lays its content out at the settled size, and animates only through
 * the theme's layout motion.
 */
import { createElement } from "react";
import type { ComponentProps } from "react";
import { describe, expect, it } from "vitest";
import { DockFrame, DockHeaderButton } from "../src/components/shell/dock-frame/dock-frame";
import { classTokens, renderStatic } from "../src/testing";

const handle = createElement("div", { "data-testid": "handle" });

const render = (props: Partial<ComponentProps<typeof DockFrame>> = {}) =>
  renderStatic(
    createElement(DockFrame, {
      position: "bottom",
      open: true,
      size: 240,
      contentSize: 240,
      animate: true,
      tabs: "TABS",
      actions: createElement(DockHeaderButton, { label: "Hide the dock", children: "×" }),
      handle,
      children: "BODY",
      ...props,
    }),
  );

describe("DockFrame", () => {
  it("says what is on screen, and animates through the layout-motion attribute only", () => {
    const html = render();
    expect(html).toMatch(/^<div data-testid="dock" data-position="bottom" data-open="true"/);
    expect(html).toContain('data-layout-motion=""');
    expect(html).toContain('style="height:240px"');
    expect(html).not.toMatch(/transition-\[/);
    expect(render({ animate: false })).not.toContain("data-layout-motion");
  });

  it("keeps a closed dock in the tree at size 0, inert, with no border and no handle", () => {
    const html = render({ open: false, size: 0 });
    expect(html).toContain('data-open="false"');
    expect(html).toContain("inert");
    expect(html).toContain('style="height:0"');
    expect(html).not.toContain("border-t");
    expect(html).not.toContain('data-testid="handle"');
    // The content still lays out at the settled size.
    expect(html).toContain('style="height:240px"');
    expect(html).toContain("BODY");
  });

  it("puts the right dock's handle before the dock, where it costs real width", () => {
    const html = render({ position: "right", size: 360, contentSize: 360 });
    expect(html).toMatch(
      /^<div data-testid="handle"><\/div><div data-testid="dock" data-position="right"/,
    );
    expect(html).toContain('style="width:360px"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-canvas", "border-l", "border-line"]),
    );
  });

  it("names a header button and gives it the tooltip", () => {
    const html = render();
    expect(html).toContain('data-tooltip="Hide the dock" aria-label="Hide the dock"');
    expect(html).toContain('data-testid="dock-header"');
  });
});
