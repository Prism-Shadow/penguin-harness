/**
 * The "?" disclosure (src/components/overlays/info-popover/info-popover.tsx): a real button that
 * names itself in the interface's words, folds the subject into that name, asks for no hover
 * tooltip (the mark beside a title says what it is, and hovering it shows the rest), opens
 * through the hover disclosure, and keeps its panel out of the tree until it is opened.
 *
 * Where it may appear — only beside a title — is the web app's `disclosure-anchor.test.ts`; the
 * field layout it forces is this package's `field.test.ts`; the hover, pin and touch rules are
 * `hover-disclosure.test.ts`, and the trigger opening on a resting mouse or a click, never on
 * focus alone, is disclosure-drag.dom.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { InfoPopover } from "../src/components/overlays/info-popover/info-popover";
import { ICONS } from "../src/components/icons/icons";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { renderStatic } from "../src/testing";

const ZH: UiStrings = {
  ...DEFAULT_UI_STRINGS,
  moreInfo: "说明",
  moreInfoAbout: (subject) => `说明：${subject}`,
};

describe("InfoPopover", () => {
  const html = renderStatic(
    createElement(InfoPopover, { children: "Values take effect from the next task." }),
  );

  it("is a real button named for assistive technology, and nothing more", () => {
    expect(html).toMatch(/^<button type="button"/);
    expect(html).toContain('aria-label="More info"');
    expect(html).not.toContain("title=");
  });

  it("asks the tooltip layer for nothing: the mark beside a title says what it is, and hovering shows the rest", () => {
    // The tooltip layer opens only on a data-tooltip (tooltip.tsx): its absence is the behaviour.
    expect(html).not.toContain("data-tooltip");
  });

  it("starts collapsed, and points at the panel it will open", () => {
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/aria-controls="[^"]+"/);
    // The panel is portaled and only mounted while open, so nothing of the text is in the tree.
    expect(html).not.toContain("Values take effect");
    expect(html).not.toContain('role="tooltip"');
  });

  it("folds the subject into its name rather than repeating it", () => {
    // A trigger inside a heading would otherwise make that heading announce its own title twice.
    const named = renderStatic(createElement(InfoPopover, { label: "Vault", children: "x" }));
    expect(named).toContain('aria-label="More info: Vault"');
    expect(named).not.toContain('aria-label="Vault"');
  });

  it("speaks the interface's words once the app provides them", () => {
    const zh = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: ZH },
        createElement(InfoPopover, { label: "Vault", children: "x" }),
      ),
    );
    expect(zh).toContain('aria-label="说明：Vault"');
    expect(zh).not.toContain("More info");
  });

  it("draws the registry's circled question mark", () => {
    expect(html).toContain(`d="${ICONS.helpCircle}"`);
  });
});
