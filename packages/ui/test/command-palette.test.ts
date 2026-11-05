/**
 * CommandPalette (src/components/overlays/command-palette/command-palette.tsx): a modal dialog
 * named by the caller, a search box named by its placeholder over a listbox whose first action
 * starts selected, the caller's empty sentence and hint, and the scrim hook on its host. The
 * filter is pure and called directly; the portal renders in place.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  filterPaletteActions,
} from "../src/components/overlays/command-palette/command-palette";
import type { CommandPaletteProps } from "../src/components/overlays/command-palette/command-palette";
import { classTokens, renderStatic } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
stubDialogGlobals();

const noop = () => {};
const ACTIONS = [
  { id: "history", label: "Harness history", keywords: ["version", "hmr"], run: noop },
  { id: "reload", label: "Reload page", run: noop },
];
const palette = (props: Partial<CommandPaletteProps> = {}) =>
  renderStatic(
    createElement(CommandPalette, {
      open: true,
      onClose: noop,
      actions: ACTIONS,
      title: "Command palette",
      placeholder: "Filter commands",
      emptyText: "Nothing matches",
      ...props,
    }),
  );

describe("filterPaletteActions", () => {
  it("lists everything for an empty query, in registration order", () => {
    expect(filterPaletteActions(ACTIONS, "  ").map((a) => a.id)).toEqual(["history", "reload"]);
  });

  it("matches every token, case-insensitively, against the label and the keywords", () => {
    expect(filterPaletteActions(ACTIONS, "HIST").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(ACTIONS, "harness hist").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(ACTIONS, "hmr").map((a) => a.id)).toEqual(["history"]);
    expect(filterPaletteActions(ACTIONS, "page harness")).toEqual([]);
  });
});

describe("CommandPalette", () => {
  it("renders nothing while closed", () => {
    expect(palette({ open: false })).toBe("");
  });

  it("is a modal dialog named by the caller, its search box named by the placeholder", () => {
    const html = palette();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Command palette"');
    expect(html).toMatch(
      /<input[^>]*placeholder="Filter commands"[^>]*aria-label="Filter commands"/,
    );
  });

  it("lists the actions as options, the first one selected", () => {
    const html = palette();
    expect(html).toContain('role="listbox"');
    const options = [...html.matchAll(/role="option" aria-selected="(true|false)"/g)].map(
      (m) => m[1],
    );
    expect(options).toEqual(["true", "false"]);
    expect(html).toContain(">Harness history</button>");
  });

  it("says the caller's sentence when there is nothing to list, and shows the hint only when given", () => {
    const empty = palette({ actions: [] });
    expect(empty).toContain(">Nothing matches</p>");
    expect(empty).not.toContain('role="listbox"');
    expect(palette()).not.toContain("border-t");
    expect(palette({ hint: "Enter to run" })).toMatch(/border-t[^"]*">Enter to run<\/div>/);
  });

  it("dims the page through the scrim hook, and paints in tokens", () => {
    expect(classTokens(palette())).toEqual(
      expect.arrayContaining([
        "ui-scrim",
        "bg-[var(--ui-overlay-backdrop)]",
        "bg-surface",
        "border-line",
        "bg-surface-muted",
      ]),
    );
  });
});
