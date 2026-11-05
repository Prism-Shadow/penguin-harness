/**
 * ListRow: a ruled row whose mark and text become one button when the row opens what it names,
 * with its own actions outside that button. SettingsList groups the installed items as a named list.
 *
 * - Given an item with metadata and an action, the list names itself and the row shows them all.
 * - Given a row that opens something, its mark and text are one button and the actions sit
 *   outside it.
 * - Given a description far longer than any row can show, the page holds only its beginning,
 *   ending in an ellipsis, and the line's hover hint carries all of it — never half a character.
 * - Given a description a row can show, it is rendered whole with no hint of its own (the
 *   tooltip layer shows a cut-off line's own text).
 *
 * How rows fit their card at every width is measured in a browser: ui-gallery's
 * e2e/list-row-width.spec.mjs.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ListRow, SettingsList } from "../src/components/data/list-row/list-row";
import { tooltipRequest } from "../src/components/overlays/tooltip/tooltip";
import { renderStatic } from "../src/testing";

const trailing = createElement("button", { type: "button", "aria-label": "Export" }, "E");

/**
 * The description line as the page holds it: its text, and the hover hint the tooltip layer reads
 * from it (null when the line carries none and the layer would show its own text).
 */
function descriptionLine(description: string) {
  const html = renderStatic(createElement(ListRow, { title: "memory", description }));
  // The description is the row's last line of text.
  const [, attributes, text] = [...html.matchAll(/<span([^>]*)>([^<]*)<\/span>/g)].at(-1)!;
  const attrs = new Map(
    [...attributes!.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name!, value!]),
  );
  return { text: text!, hint: tooltipRequest({ getAttribute: (name) => attrs.get(name) ?? null }) };
}

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

  it("puts only the beginning of a very long description on the page, the whole of it in the hint", () => {
    const description = "记忆 memory ".repeat(20_000);
    const line = descriptionLine(description);
    expect(line.text.length).toBeLessThan(description.length / 10);
    expect(line.text.endsWith("…")).toBe(true);
    expect(description.startsWith(line.text.slice(0, -1))).toBe(true);
    // Marked: the hint says what the page does not, so it opens over the visible line.
    expect(line.hint).toMatchObject({ label: description, content: "text", extra: true });
  });

  it("never cuts a long description through the middle of a character", () => {
    // A two-unit character, then the same one unit later: one of the two lands across any cut.
    for (const description of ["😀".repeat(100_000), `a${"😀".repeat(100_000)}`]) {
      expect(descriptionLine(description).text).not.toMatch(/\p{Cs}/u);
    }
  });

  it("renders a description a row can show whole, with no hint of its own", () => {
    const line = descriptionLine("Reads PDFs and fills in their forms.");
    expect(line.text).toBe("Reads PDFs and fills in their forms.");
    expect(line.hint).toBeNull();
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
