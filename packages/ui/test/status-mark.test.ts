/**
 * StatusMark (src/components/feedback/status-mark/status-mark.tsx): a status as a glyph and a
 * word, the hover sentence saying what it means for this thing.
 *
 * - Given a status with a hint, the word is the mark's text and the hint its tooltip, marked as
 *   saying what the word does not, so it opens over the visible word.
 * - Given a status that recedes (no tone), the mark still names it in words; the glyph is never
 *   the carrier, so assistive technology skips it.
 * - Given no hint, the mark carries no tooltip of its own.
 * - Given extra attributes, they land on the mark itself (a page's tests find it by them).
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { StatusMark } from "../src/components/feedback/status-mark/status-mark";
import { ICONS } from "../src/components/icons/icons";
import { tooltipRequest } from "../src/components/overlays/tooltip/tooltip";
import { renderStatic } from "../src/testing";

/** The attributes of the mark's own element, the first in the markup. */
function outerAttributes(html: string): Map<string, string> {
  const open = /^<span([^>]*)>/.exec(html)![1]!;
  return new Map([...open.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k!, v!]));
}

const text = (html: string) => html.replace(/<[^>]+>/g, "").trim();

describe("StatusMark", () => {
  it("shows its word, with the hint as a marked tooltip", () => {
    const html = renderStatic(
      createElement(StatusMark, {
        glyph: ICONS.rotateCw,
        tone: "attention",
        label: "Update",
        hint: "2 agents are behind",
      }),
    );
    expect(text(html)).toBe("Update");
    const attrs = outerAttributes(html);
    expect(tooltipRequest({ getAttribute: (name) => attrs.get(name) ?? null })).toMatchObject({
      label: "2 agents are behind",
      content: "text",
      extra: true,
    });
  });

  it("names a receding status in words, its glyph hidden from assistive technology", () => {
    const html = renderStatic(
      createElement(StatusMark, { glyph: ICONS.download, label: "Available" }),
    );
    expect(text(html)).toBe("Available");
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("carries no tooltip without a hint", () => {
    const html = renderStatic(
      createElement(StatusMark, { glyph: ICONS.checkCircle, tone: "success", label: "Installed" }),
    );
    expect(outerAttributes(html).has("data-tooltip")).toBe(false);
  });

  it("puts extra attributes on the mark itself", () => {
    const html = renderStatic(
      createElement(StatusMark, {
        glyph: ICONS.checkCircle,
        tone: "success",
        label: "Installed",
        "data-testid": "plugin-status",
      } as Parameters<typeof StatusMark>[0]),
    );
    expect(outerAttributes(html).get("data-testid")).toBe("plugin-status");
  });
});
