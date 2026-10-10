/**
 * The inline help fold (src/components/overlays/info-popover/help-fold.tsx): the disclosure a
 * surface uses when it has no title for a circled "?" to anchor to. The web app's
 * `disclosure-anchor.test.ts` enforces when to reach for it; this covers what it renders.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { HelpFold } from "../src/components/overlays/info-popover/help-fold";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { renderStatic } from "../src/testing";

const DESC = "The vault stores values that commands can read at run time.";

describe("HelpFold", () => {
  const html = renderStatic(createElement(HelpFold, { children: DESC }));

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

  it("names itself in the interface's words, since it has no title beside it", () => {
    expect(html).toContain(DEFAULT_UI_STRINGS.moreInfo);
    const zh: UiStrings = {
      ...DEFAULT_UI_STRINGS,
      moreInfo: "说明",
      moreInfoAbout: (subject) => `说明：${subject}`,
    };
    const localized = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: zh },
        createElement(HelpFold, { label: "Vault", children: DESC }),
      ),
    );
    expect(localized).toContain(">说明</button>");
    expect(localized).toContain('aria-label="说明：Vault"');
  });

  it("rotates the app's one collapse chevron rather than inventing an indicator", () => {
    // chevron.tsx's glyph and its 90-degree rotation; every other collapsible in the app uses it.
    expect(html).toContain('d="M9 5l7 7-7 7"');
    expect(html).not.toContain("rotate-90");
  });

  it("indents the body under the label, unless the caller asks for a flush block", () => {
    // A block with its own left edge — a code box — has to line up with what sits above it, so
    // the chevron's indent is dropped; a run of prose keeps it.
    expect(html).toContain("pl-4.5");
    const flush = renderStatic(createElement(HelpFold, { flush: true, children: DESC }));
    expect(flush).not.toContain("pl-4.5");
  });

  it("folds the subject into the accessible name, keeping the visible text a prefix of it", () => {
    // WCAG "label in name": a voice-control user must be able to say what they can see.
    const named = renderStatic(createElement(HelpFold, { label: "Vault", children: DESC }));
    const accessible = DEFAULT_UI_STRINGS.moreInfoAbout("Vault");
    expect(named).toContain(`aria-label="${accessible}"`);
    expect(accessible.startsWith(DEFAULT_UI_STRINGS.moreInfo)).toBe(true);
  });

  it("lets a fold in a stack title itself, and then carries no second name", () => {
    // A column of identical "More info" rows says nothing about which one to open, so an FAQ
    // titles each fold. The visible title IS the accessible name — an aria-label beside it
    // would be a second name for one trigger, which is what breaks "label in name".
    const titled = renderStatic(
      createElement(HelpFold, { title: "Set up the bot", label: "Vault", children: DESC }),
    );
    expect(titled).toContain("Set up the bot");
    expect(titled).not.toContain(DEFAULT_UI_STRINGS.moreInfo);
    expect(titled).not.toContain("aria-label=");
  });
});
