/**
 * RuledSection: the title is a group label (the eyebrow role) inside the section's heading, the
 * count is the package's tabular Count, and the rule under the title is a token line.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { RuledSection } from "../src/components/layout/ruled-section/ruled-section";
import { renderStatic } from "../src/testing";

describe("RuledSection", () => {
  const html = renderStatic(
    createElement(
      RuledSection,
      {
        title: "Inbox",
        count: 3,
        info: "Tickets waiting on you.",
        actions: createElement("button", { type: "button" }, "Filter"),
      },
      createElement("p", null, "rows"),
    ),
  );

  it("is a section headed by an eyebrow inside an h2", () => {
    expect(html).toMatch(/^<section class="[^"]*">/);
    expect(html).toMatch(/<h2 class="[^"]*"><span class="ui-eyebrow [^"]*">Inbox<\/span>/);
  });

  it("shows the trigger and the actions, then the body", () => {
    expect(html).toMatch(/<span class="[^"]*">3<\/span>/);
    expect(html).toContain('aria-label="More info: Inbox"');
    expect(html.indexOf("Filter")).toBeLessThan(html.indexOf("rows"));
  });

  it("drops what it is not given, and takes a level-3 heading inside a dialog", () => {
    const bare = renderStatic(createElement(RuledSection, { title: "Goal", level: 3 }, "text"));
    expect(bare).toContain("<h3");
    expect(bare).not.toContain("<button");
  });
});
