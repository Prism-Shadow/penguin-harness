/**
 * ListRow: a ruled row whose mark and text become one button when the row opens what it names,
 * with its own actions outside that button. SettingsList groups the installed items as a named list.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ListRow, SettingsList } from "../src/components/data/list-row/list-row";
import { renderStatic } from "../src/testing";

const trailing = createElement("button", { type: "button", "aria-label": "Export" }, "E");

describe("ListRow", () => {
  it("groups named items, with metadata and independent actions", () => {
    const html = renderStatic(
      createElement(SettingsList, {
        label: "Installed skills",
        children: createElement(ListRow, {
          as: "li",
          title: "pdf",
          description: "Reads PDFs.",
          meta: "2 KB",
          trailing,
        }),
      }),
    );
    expect(html).toContain('<ul aria-label="Installed skills"><li');
    expect(html).toContain("pdf");
    expect(html).toContain("Reads PDFs.");
    expect(html).toContain("2 KB");
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
      /<button type="button" class="[^"]*"><span[^>]*><img[^>]*\/><\/span>(?:(?!<\/button>).)*case-01(?:(?!<\/button>).)*<\/button><div[^>]*><div[^>]*><button type="button" aria-label="Export">/,
    );
  });
});
