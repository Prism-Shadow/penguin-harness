/**
 * Modal (src/components/overlays/modal/modal.tsx): a named modal dialog on both branches, whose
 * close cross speaks the interface's words, with the scrim and glass hooks on their host. The
 * focus and Escape wiring is pinned against the source by the web app's modal-focus.test.ts; here
 * the dialog renders once, its portal replaced by an in-place render.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "../src/components/overlays/modal/modal";
import type { ModalProps } from "../src/components/overlays/modal/modal";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
stubDialogGlobals();

const noop = () => {};
const modal = (props: Partial<ModalProps> = {}) =>
  renderStatic(
    createElement(Modal, {
      open: true,
      title: "Rename session",
      onClose: noop,
      children: "Body",
      ...props,
    }),
  );

describe("Modal", () => {
  it("renders nothing while closed", () => {
    expect(modal({ open: false })).toBe("");
  });

  it("is a modal dialog named by its own heading", () => {
    const html = modal();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
    const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeDefined();
    expect(html).toContain(`<h2 id="${id}"`);
    expect(html).toContain(">Rename session</h2>");
  });

  it("names a headerless dialog by its title alone, with no heading and no close cross", () => {
    const html = modal({ headerless: true });
    expect(html).toContain('aria-label="Rename session"');
    expect(html).not.toContain("aria-labelledby");
    expect(html).not.toContain("<h2");
    expect(html).not.toContain('aria-label="Close"');
  });

  it("names its close cross in the interface's words, or the caller's", () => {
    expect(modal()).toContain('aria-label="Close"');
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, close: "关闭" } },
        createElement(Modal, { open: true, title: "t", onClose: noop, children: "Body" }),
      ),
    );
    expect(injected).toContain('aria-label="关闭"');
    expect(modal({ closeLabel: "Close the rename dialog" })).toContain(
      'aria-label="Close the rename dialog"',
    );
  });

  it("pads and scrolls its body unless the caller owns the layout", () => {
    // The body names its slot, which a theme reads to close up a dropped head rule's gap.
    expect(modal()).toMatch(/data-slot="body" class="max-h-\[70vh\]/);
    expect(modal({ bare: true })).not.toContain("max-h-[70vh]");
    expect(modal({ bare: true })).not.toContain('data-slot="body"');
    expect(modal({ footer: "Actions" })).toMatch(/border-t border-line[^"]*">Actions<\/div>/);
  });

  it("carries the scrim and glass hooks, and paints in tokens", () => {
    expect(classTokens(modal())).toEqual(
      expect.arrayContaining([
        "ui-scrim",
        "ui-glass",
        "bg-[var(--ui-overlay-backdrop)]",
        "bg-surface",
        "border-line",
        "shadow-xl",
        "sm:max-w-md",
      ]),
    );
    expect(classTokens(modal({ widthClass: "sm:max-w-3xl" }))).toContain("sm:max-w-3xl");
  });
});
