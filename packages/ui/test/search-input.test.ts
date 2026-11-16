/**
 * SearchInput (src/components/forms/search-input/search-input.tsx): a search field that opts out
 * of autofill, with a clear button named in the interface's words, an optional magnifier and
 * three shapes for the three kinds of container.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import { SearchInput } from "../src/components/forms/search-input/search-input";
import type { SearchInputProps } from "../src/components/forms/search-input/search-input";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { renderStatic } from "../src/testing";

const noop = () => {};
const search = (props: Partial<SearchInputProps> = {}) =>
  renderStatic(
    createElement(SearchInput, { value: "", onChange: noop, "aria-label": "Search", ...props }),
  );

describe("SearchInput", () => {
  it("is a search field named by the caller, kept away from saved logins", () => {
    const html = search();
    expect(html).toMatch(/<input type="search"[^>]*value=""/);
    expect(html).toContain('aria-label="Search"');
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).toContain("data-1p-ignore");
  });

  it("offers the clear button only while there is something to clear, named but not hinted", () => {
    expect(search()).not.toContain("<button");
    const filled = search({ value: "agent" });
    expect(filled).toMatch(/<button type="button" aria-label="Clear search"(?! data-tooltip)/);
  });

  it("names the clear button in the injected words, and a caller's label over both", () => {
    const strings = { ...DEFAULT_UI_STRINGS, clearSearch: "清除搜索" };
    const injected = renderStatic(
      createElement(
        UiStringsProvider,
        { strings },
        createElement(SearchInput, { value: "a", onChange: noop, "aria-label": "搜索" }),
      ),
    );
    expect(injected).toContain('aria-label="清除搜索"');
    expect(search({ value: "a", clearLabel: "Clear the filter" })).toContain(
      'aria-label="Clear the filter"',
    );
  });

  it("keeps the clear button in an empty box that closes when cleared", () => {
    expect(search({ alwaysClearable: true })).toContain("<button");
  });

  it("draws the magnifier before the text when asked, and pads past it", () => {
    const html = search({ icon: true });
    expect(html).toContain(`d="${ICONS.search}"`);
    expect(search()).not.toContain(`d="${ICONS.search}"`);
  });

  it("puts the hover hint in the shared tooltip", () => {
    const html = search({ className: "w-44", title: "Filter by name" });
    expect(html).toContain('data-tooltip="Filter by name"');
    expect(html).not.toContain("title=");
  });
});
