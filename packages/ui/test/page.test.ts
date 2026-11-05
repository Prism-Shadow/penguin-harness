/**
 * PageFrame and PageHeader: the frame scrolls and centres its column at the chosen width; the
 * header's title is the page's one display h1 at the app's page-title size (not the theme's h1
 * rung), with no eyebrow, its "?" named through UiStrings, the way back above it and the actions
 * after it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PageFrame, PageHeader } from "../src/components/layout/page/page";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import { classTokens, renderStatic } from "../src/testing";

describe("PageFrame", () => {
  it("scrolls on its own and centres its column at the chosen width", () => {
    const html = renderStatic(createElement(PageFrame, null, "content"));
    expect(html).toMatch(
      /^<div class="h-full overflow-y-auto p-4 md:p-6 *"><div class="mx-auto max-w-5xl/,
    );
    expect(renderStatic(createElement(PageFrame, { width: "xl" }))).toContain("max-w-6xl");
    const full = classTokens(renderStatic(createElement(PageFrame, { width: "full" })));
    expect(full).toContain("min-w-0");
    expect(full.filter((t) => t.startsWith("max-w-"))).toEqual([]);
  });
});

describe("PageHeader", () => {
  it("titles the page with the display h1 at the page-title size, and no eyebrow", () => {
    const html = renderStatic(createElement(PageHeader, { title: "Agents" }));
    expect(html).toMatch(/<h1 class="ui-display [^"]*">Agents<\/h1>/);
    const title = /<h1 class="([^"]*)"/.exec(html)![1]!.split(/\s+/);
    expect(title).toEqual(expect.arrayContaining(["text-xl", "font-semibold"]));
    expect(title.filter((t) => t.includes("--ui-h1-"))).toEqual([]);
    expect(html).not.toContain("ui-eyebrow");
  });

  it("names its trigger through UiStrings and keeps the explanation behind it", () => {
    const html = renderStatic(
      createElement(
        UiStringsProvider,
        { strings: { ...DEFAULT_UI_STRINGS, moreInfoAbout: (s: string) => `About ${s}` } },
        createElement(PageHeader, { title: "Models", info: "Where models come from." }),
      ),
    );
    expect(html).toContain('aria-label="About Models"');
    expect(html).not.toContain("Where models come from.");
  });

  it("draws the way back above the title, the description under it and the actions after it", () => {
    const html = renderStatic(
      createElement(
        PageHeader,
        {
          title: "Reviewer",
          description: "agent-reviewer",
          back: { label: "All agents", onClick: () => {} },
          actions: createElement("button", { type: "button" }, "Run"),
        },
        createElement("p", null, "A notice"),
      ),
    );
    const order = ["All agents", "<h1", "agent-reviewer", "Run", "A notice"].map((part) =>
      html.indexOf(part),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toMatch(/<button type="button"[^>]*>(?:(?!<\/button>).)*<svg/);
  });
});
