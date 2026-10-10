/**
 * PickerList (src/components/forms/picker-list/picker-list.tsx): a search box over a list whose
 * rows differ only in content. The box is autofocused and named by its placeholder, nothing starts
 * highlighted, the entry in effect carries the check, and an empty result says so.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PickerList } from "../src/components/forms/picker-list/picker-list";
import { classTokens, renderStatic } from "../src/testing";

const render = (items: string[], extra: { footer?: string } = {}) =>
  renderStatic(
    createElement(PickerList<string>, {
      items,
      itemKey: (item) => item,
      isCurrent: (item) => item === "beta",
      query: "",
      onQueryChange: () => {},
      searchPlaceholder: "Search models",
      emptyText: "No match",
      onPick: () => {},
      renderRow: (item) => createElement("span", { className: "row" }, item),
      ...(extra.footer !== undefined ? { footer: createElement("p", null, extra.footer) } : {}),
    }),
  );

describe("PickerList", () => {
  it("puts an autofocused search box, named by its placeholder, above the rows", () => {
    const html = render(["alpha", "beta"]);
    const input = /<input\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(input).toContain('aria-label="Search models"');
    expect(input).toContain('placeholder="Search models"');
    expect(input).toContain("autofocus");
    expect(html.indexOf("<input")).toBeLessThan(html.indexOf("alpha"));
  });

  it("checks only the entry in effect, and fills that row", () => {
    const html = render(["alpha", "beta"]);
    const rows = html.split("<button").filter((chunk) => chunk.includes('class="row"'));
    expect(rows).toHaveLength(2);
    expect(rows[0]).not.toContain("<svg");
    expect(rows[1]).toContain("<svg");
    expect(classTokens(`<b${rows[1]!}`)).toContain("bg-surface-muted");
    // Nothing is highlighted before the keyboard asks for it.
    expect(classTokens(html)).not.toContain("bg-line-muted");
  });

  it("says so when nothing matches, and pins the footer below the list", () => {
    const html = render([], { footer: "Show all" });
    expect(html).toContain("No match");
    expect(classTokens(html)).toContain("text-fg-subtle");
    expect(html.indexOf("No match")).toBeLessThan(html.indexOf("Show all"));
  });
});
