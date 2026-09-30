/**
 * Lightbox and ZoomableImage (src/components/overlays/lightbox/lightbox.tsx): the thumbnail keeps
 * the caller's styling and mounts nothing else until clicked; the lightbox names its close glyph in
 * the interface's words, dims the page through the scrim hook, and closes on Escape only through
 * the shared layer stack, so a lightbox opened inside a dialog closes alone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox, ZoomableImage } from "../src/components/overlays/lightbox/lightbox";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";
import { SRC_DIR } from "./helpers/paths";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
stubDialogGlobals();

const noop = () => {};
const lightbox = (closeLabel?: string) =>
  renderStatic(
    createElement(Lightbox, { open: true, src: "/a.png", alt: "Chart", onClose: noop, closeLabel }),
  );

describe("ZoomableImage", () => {
  it("is a button around the caller's thumbnail, with the lightbox not yet mounted", () => {
    const html = renderStatic(
      createElement(ZoomableImage, { src: "/a.png", alt: "Chart", className: "h-20" }),
    );
    // React 19's server renderer prepends a preload hint for an eager image; not our markup.
    expect(html.replace(/^<link rel="preload"[^>]*\/>/, "")).toBe(
      '<button type="button" class="block cursor-zoom-in"><img src="/a.png" alt="Chart" class="h-20"/></button>',
    );
  });
});

describe("Lightbox", () => {
  it("renders nothing while closed", () => {
    expect(
      renderStatic(
        createElement(Lightbox, { open: false, src: "/a.png", alt: "Chart", onClose: noop }),
      ),
    ).toBe("");
  });

  it("shows the image whole, with its alt text", () => {
    expect(lightbox()).toMatch(/<img src="\/a\.png" alt="Chart" class="[^"]*"\/>/);
  });

  it("names its close glyph in the interface's words, or the caller's", () => {
    expect(lightbox()).toContain('aria-label="Close"');
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, close: "关闭" } },
        createElement(Lightbox, { open: true, src: "/a.png", alt: "Chart", onClose: noop }),
      ),
    );
    expect(injected).toContain('aria-label="关闭"');
    expect(lightbox("Close the image")).toContain('aria-label="Close the image"');
  });

  it("dims the page through the scrim, and paints in tokens", () => {
    expect(classTokens(lightbox())).toEqual(
      expect.arrayContaining([
        "ui-scrim",
        "bg-[var(--ui-overlay-backdrop)]",
        "bg-fg/50",
        "text-canvas",
        "border-line",
        "bg-surface",
      ]),
    );
  });

  it("closes on Escape through the shared layer stack, never a listener of its own", () => {
    const text = readFileSync(join(SRC_DIR, "components/overlays/lightbox/lightbox.tsx"), "utf8");
    expect(text).toContain("useEscLayer(open, onClose)");
    expect(text).not.toMatch(/"keydown"/);
  });
});
