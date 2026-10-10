/**
 * CollapsibleSection: the head is one toggle button naming the body it controls, the section's
 * actions stay outside it, and the fold is the grid-row tween the theme moves through
 * `data-layout-motion` — the component spells no transition of a size itself. The clip sits on
 * the grid's own box, never on the row inside it, which would show a blank band mid-fold.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { CollapsibleSection } from "../src/components/layout/collapsible-section/collapsible-section";
import type { CollapsibleSectionProps } from "../src/components/layout/collapsible-section/collapsible-section";
import { classTokens, renderStatic } from "../src/testing";

const render = (props: Partial<CollapsibleSectionProps>) =>
  renderStatic(
    createElement(
      CollapsibleSection,
      { title: "OpenAI", ...props },
      createElement("p", null, "rows"),
    ),
  );

describe("CollapsibleSection", () => {
  it("is a flush card: a head slot with the toggle, a body slot with the rows", () => {
    const html = render({ actions: createElement("button", { type: "button" }, "Add") });
    expect(html).toMatch(/^<section class="ui-frame /);
    expect(html).toContain('data-slot="head"');
    expect(html).toContain('data-slot="body"');
    const toggle = /<button type="button" aria-expanded="true" aria-controls="([^"]+)"/.exec(html);
    expect(toggle).not.toBeNull();
    expect(html).toContain(`id="${toggle![1]}"`);
    // The action is a sibling of the toggle, never inside it.
    expect(html).toMatch(/<\/button><div class="[^"]*"><button type="button">Add<\/button>/);
  });

  it("folds through the layout-motion grid, clipped at the grid's box, and is inert while folded", () => {
    const open = render({});
    expect(open).toMatch(
      /data-slot="body" data-layout-motion="true" class="grid overflow-clip grid-rows-\[1fr\]"/,
    );
    expect(open).not.toContain("inert");
    const folded = render({ defaultOpen: false });
    expect(folded).toContain('aria-expanded="false"');
    expect(folded).toMatch(/class="grid overflow-clip grid-rows-\[0fr\]"/);
    expect(folded).toMatch(/<div id="[^"]+" class="min-h-0" inert="">/);
    for (const html of [open, folded]) {
      // The row inside the grid clips nothing: a clip there vanishes ahead of the grid's height.
      // (The section's own frame clips its rounded corners; that box is not the fold's row.)
      expect(html).not.toMatch(/<div id="[^"]+" class="[^"]*overflow-(hidden|clip)/);
      expect(classTokens(html).filter((t) => /^transition-\[/.test(t))).toEqual([]);
    }
  });

  it("follows the caller's open over its own default", () => {
    expect(render({ open: false, defaultOpen: true })).toContain('aria-expanded="false"');
  });
});
