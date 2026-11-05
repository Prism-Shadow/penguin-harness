/**
 * PagedDialog (src/components/overlays/paged-dialog/paged-dialog.tsx): a dialog with a page rail.
 * The rail is a named navigation whose active row is the current page, group headings appear only
 * when there is more than one group and set on the eyebrow rung, the rail glyphs are decorative,
 * and the pane heading is the active page's label with its "?" when the page explains itself.
 */
import { createElement } from "react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PagedDialog } from "../src/components/overlays/paged-dialog/paged-dialog";
import type { PagedDialogGroup } from "../src/components/overlays/paged-dialog/paged-dialog";
import { classTokens, renderStatic } from "../src/testing";
import { stubDialogGlobals } from "./helpers/dialog-env";

vi.mock("react-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-dom")>()),
  createPortal: (node: ReactNode) => node,
}));
stubDialogGlobals();

type Page = "general" | "appearance" | "account";

const GROUPS: PagedDialogGroup<Page>[] = [
  {
    key: "app",
    label: "App",
    items: [
      { key: "general", label: "General", icon: createElement("svg") },
      { key: "appearance", label: "Appearance", info: "Theme and density." },
    ],
  },
  { key: "you", label: "You", items: [{ key: "account", label: "Account" }] },
];

const dialog = (groups: PagedDialogGroup<Page>[], active: Page) =>
  renderStatic(
    createElement(PagedDialog<Page>, {
      open: true,
      onClose: () => {},
      title: "Settings",
      groups,
      active,
      onSelect: () => {},
      children: "Pane",
    }),
  );

describe("PagedDialog", () => {
  it("is a dialog named by its title, with the rail as a navigation of the same name", () => {
    const html = dialog(GROUPS, "general");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Settings"');
    expect(html).toMatch(/<nav aria-label="Settings"/);
  });

  it("marks the active page as the current one, and only it", () => {
    const html = dialog(GROUPS, "appearance");
    expect([...html.matchAll(/aria-current="page"/g)]).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*><span class="min-w-0 truncate">Appearance</);
  });

  it("heads the pane with the active page's label, and its explanation behind a ?", () => {
    const html = dialog(GROUPS, "appearance");
    expect(html).toMatch(/<h2[^>]*>Appearance/);
    expect(html).toContain('aria-label="More info: Appearance"');
    expect(dialog(GROUPS, "general")).not.toContain("More info");
  });

  it("sets group headings on the eyebrow rung, and drops a lone group's heading", () => {
    const html = dialog(GROUPS, "general");
    expect(html).toMatch(/<p class="ui-eyebrow [^"]*">App<\/p>/);
    expect(html).toMatch(/<p class="ui-eyebrow [^"]*">You<\/p>/);
    expect(classTokens(html)).not.toContain("uppercase");
    const lone = dialog([GROUPS[0]!], "general");
    expect(lone).not.toContain("ui-eyebrow");
  });

  it("marks the rail glyphs as decoration", () => {
    expect(dialog(GROUPS, "general")).toMatch(
      /<span aria-hidden="true" class="ui-icon-decor [^"]*" data-role="nav"><svg><\/svg><\/span>/,
    );
  });
});
