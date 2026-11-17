/**
 * Drawer and Sheet (src/components/overlays/drawer/): the side panel and the spring sheet. Both
 * render in place (no portal), dim the page through the scrim hook, name their close cross in the
 * interface's words. Escape through the shared layer stack (a menu opened inside one takes the
 * first Escape alone) is overlay-layers.dom.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Drawer } from "../src/components/overlays/drawer/drawer";
import { Sheet } from "../src/components/overlays/drawer/sheet";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

const noop = () => {};

describe("Drawer", () => {
  const drawer = (side?: "left" | "right") =>
    renderStatic(
      createElement(Drawer, {
        open: true,
        side,
        title: "Navigation",
        onClose: noop,
        children: "x",
      }),
    );

  it("renders nothing while closed", () => {
    expect(renderStatic(createElement(Drawer, { open: false, onClose: noop, children: "x" }))).toBe(
      "",
    );
  });

  it("dims the page through the scrim hook", () => {
    expect(classTokens(drawer())).toContain("ui-scrim");
  });

  it("shows its title and names its close cross in the interface's words", () => {
    const html = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, close: "关闭" } },
        createElement(Drawer, { open: true, title: "Navigation", onClose: noop, children: "x" }),
      ),
    );
    expect(html).toContain(">Navigation</span>");
    expect(html).toContain('aria-label="关闭"');
  });
});

describe("Sheet", () => {
  const sheet = () =>
    renderStatic(
      createElement(Sheet, {
        open: true,
        snap: "half",
        title: "Files",
        onClose: noop,
        children: "x",
      }),
    );

  it("renders nothing before it first opens", () => {
    expect(
      renderStatic(
        createElement(Sheet, { open: false, snap: "half", onClose: noop, children: "x" }),
      ),
    ).toBe("");
  });

  it("is a modal dialog named by its title", () => {
    const html = sheet();
    expect(html).toMatch(/^<div class="[^"]*" role="dialog" aria-modal="true" aria-label="Files">/);
    expect(html).toContain('aria-label="Close"');
  });

  it("dims the page through the scrim hook, as the Drawer does", () => {
    expect(classTokens(sheet())).toContain("ui-scrim");
  });
});
