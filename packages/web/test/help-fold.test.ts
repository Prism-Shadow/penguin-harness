/**
 * The inline help fold (src/components/ui/help-fold.tsx): the disclosure a surface uses when it
 * has no title for a circled "?" to anchor to. `test/disclosure-anchor.test.ts` enforces when to
 * reach for it; this covers what it renders.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpFold } from "../src/components/ui/help-fold";
import { S } from "../src/lib/strings";

const DESC = "The vault stores values that commands can read at run time.";

describe("HelpFold", () => {
  const html = renderToStaticMarkup(createElement(HelpFold, { children: DESC }));

  it("is a real button that starts collapsed and controls its panel", () => {
    expect(html).toContain("<button");
    expect(html).toContain('type="button"');
    expect(html).toContain('aria-expanded="false"');
    const controls = /aria-controls="([^"]+)"/.exec(html);
    expect(controls, "the trigger must name the panel it opens").not.toBeNull();
    // Unlike the portaled popover, the panel is a real node in flow at all times, so the id the
    // trigger points at always resolves — the WAI-ARIA disclosure pattern.
    expect(html).toContain(`id="${controls?.[1]}"`);
  });

  it("hides the explanation until it is asked for", () => {
    // `hidden` rather than absent: the text must not show up uninvited, and must not be found by
    // find-in-page while folded, but the panel node itself has to stay for aria-controls.
    expect(html).toMatch(/<div id="[^"]+" hidden/);
    expect(html).toContain(DESC);
  });

  it("names itself, since it has no title beside it to borrow meaning from", () => {
    expect(html).toContain(S.common.moreInfo);
  });

  it("rotates the app's one collapse chevron rather than inventing an indicator", () => {
    // chevron.tsx's glyph and its 90-degree rotation; every other collapsible in the app uses it.
    expect(html).toContain('d="M9 5l7 7-7 7"');
    expect(html).not.toContain("rotate-90");
  });

  it("folds the subject into the accessible name, keeping the visible text a prefix of it", () => {
    // WCAG "label in name": a voice-control user must be able to say what they can see.
    const named = renderToStaticMarkup(createElement(HelpFold, { label: "Vault", children: DESC }));
    const accessible = S.common.moreInfoAbout("Vault");
    expect(named).toContain(`aria-label="${accessible}"`);
    expect(accessible.startsWith(S.common.moreInfo)).toBe(true);
  });
});
