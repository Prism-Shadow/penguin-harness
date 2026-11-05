/**
 * Tabs (src/components/navigation/tabs/tabs.tsx): a tab list whose selected tab the theme marks
 * through the underline hook, and whose update badge reaches the tab's name and tooltip.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "../src/components/navigation/tabs/tabs";
import { classTokens, renderStatic } from "../src/testing";

const render = (badge: string | null = null) =>
  renderStatic(
    createElement(Tabs<"a" | "b">, {
      items: [
        { key: "a", label: "Overview" },
        { key: "b", label: "Skills", badge },
      ],
      active: "a",
      onChange: () => {},
    }),
  );

describe("Tabs", () => {
  it("is a tab list with exactly one selected tab, on the underline hook", () => {
    const html = render();
    expect(html).toMatch(/^<div role="tablist" class="ui-underline-nav /);
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["border-line", "border-fg"]));
  });

  it("folds a badge's sentence into its tab's name and tooltip, and says nothing without one", () => {
    const html = render("3 skills can be updated");
    expect(html).toContain('aria-label="Skills · 3 skills can be updated"');
    expect(html).toContain('data-tooltip="3 skills can be updated"');
    expect(render()).not.toContain("aria-label");
  });
});
