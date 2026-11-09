/**
 * Lightbox and ZoomableImage (src/components/overlays/lightbox/lightbox.tsx): the thumbnail keeps
 * the caller's styling and mounts nothing else until clicked; the lightbox names its close glyph in
 * the interface's words and dims the page through the scrim hook. Escape through the shared layer
 * stack (a layer above it keeps it open) is overlay-layers.dom.test.ts.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Lightbox, ZoomableImage } from "../src/components/overlays/lightbox/lightbox";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic, markupStructure } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";

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
    expect(markupStructure(html.replace(/^<link rel="preload"[^>]*\/>/, ""))).toBe(
      '<button type="button"><img src="/a.png" alt="Chart"/></button>',
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

  it("dims the page through the scrim hook", () => {
    expect(classTokens(lightbox())).toContain("ui-scrim");
  });
});
