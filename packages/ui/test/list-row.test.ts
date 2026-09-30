/**
 * ListRow: a ruled row whose mark and text become one button when the row opens what it names,
 * with its own actions outside that button.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ListRow } from "../src/components/data/list-row/list-row";
import { classTokens, renderStatic } from "../src/testing";

const trailing = createElement("button", { type: "button", "aria-label": "Export" }, "E");

describe("ListRow", () => {
  it("is a ruled row that lightens under the pointer, on tokens", () => {
    const html = renderStatic(
      createElement(ListRow, { title: "pdf", description: "Reads PDFs.", meta: "2 KB", trailing }),
    );
    expect(html).toMatch(/^<div class="flex items-center gap-3 border-b border-line-muted /);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["last:border-b-0", "hover:bg-surface-muted", "text-fg-muted"]),
    );
    // Not a button when it opens nothing: the only button is the action.
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it("makes the mark and the text one button when it opens something, the actions outside it", () => {
    const html = renderStatic(
      createElement(ListRow, {
        as: "li",
        leading: createElement("img", { alt: "", src: "/a.svg" }),
        title: "case-01",
        onClick: () => {},
        trailing,
      }),
    );
    // React 19's server renderer prepends a preload hint for an eager image; not our markup.
    expect(html.replace(/^<link rel="preload"[^>]*\/>/, "")).toMatch(/^<li /);
    expect(html).toMatch(
      /<button type="button" class="[^"]*"><span[^>]*><img[^>]*\/><\/span>(?:(?!<\/button>).)*case-01(?:(?!<\/button>).)*<\/button><div[^>]*><button type="button" aria-label="Export">/,
    );
  });
});
