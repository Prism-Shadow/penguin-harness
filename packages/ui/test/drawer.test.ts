/**
 * Drawer and Sheet (src/components/overlays/drawer/): the side panel and the spring sheet. Both
 * render in place (no portal), dim the page through the scrim hook, name their close cross in the
 * interface's words, and close on Escape only through the shared layer stack, so a dialog opened
 * from inside one takes the first Escape alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Drawer } from "../src/components/overlays/drawer/drawer";
import { Sheet } from "../src/components/overlays/drawer/sheet";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const noop = () => {};
const source = (rel: string) => readFileSync(join(SRC_DIR, rel), "utf8");

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

  it("docks to the side it is given, ruled off the page on its inner edge", () => {
    expect(classTokens(drawer())).toEqual(expect.arrayContaining(["left-0", "border-r"]));
    expect(classTokens(drawer("right"))).toEqual(expect.arrayContaining(["right-0", "border-l"]));
  });

  it("dims the page through the scrim, and paints its panel in tokens", () => {
    expect(classTokens(drawer())).toEqual(
      expect.arrayContaining([
        "ui-scrim",
        "bg-[var(--ui-overlay-backdrop)]",
        "bg-surface",
        "border-line",
        "shadow-xl",
      ]),
    );
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

  it("dims the page through the scrim, and lifts its panel on the drawer shadow token", () => {
    expect(classTokens(sheet())).toEqual(
      expect.arrayContaining([
        "ui-scrim",
        "bg-[var(--ui-overlay-backdrop)]",
        "bg-surface",
        "border-line",
        "shadow-[var(--ui-shadow-drawer)]",
        "bg-line-emphasis",
      ]),
    );
  });
});

describe("the drawer family's Escape", () => {
  it("goes through the shared layer stack, never a listener of its own", () => {
    const drawer = source("components/overlays/drawer/drawer.tsx");
    const sheet = source("components/overlays/drawer/sheet.tsx");
    expect(drawer).toContain("useEscLayer(open, onClose)");
    expect(sheet).toContain("useEscLayer(mounted && open, onClose)");
    for (const text of [drawer, sheet]) expect(text).not.toMatch(/"keydown"/);
  });
});
