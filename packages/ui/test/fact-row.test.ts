/**
 * FactList and FactRow (src/components/data/fact-row/fact-row.tsx): a detail section's dense
 * one-line rows.
 *
 * - Given a row with a glyph, a name, facts and marks, they read in that order, the marks last.
 * - Given a muted row — something absent — it keeps its name and its trailing mark.
 * - Given a row with no facts, the marks still close the row.
 * - Given a label, the list is named by it; without one it has no name of its own.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { FactList, FactRow } from "../src/components/data/fact-row/fact-row";
import { ICONS } from "../src/components/icons/icons";
import { renderStatic } from "../src/testing";

const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const mark = (word: string) => createElement("span", { role: "img", "aria-label": word }, word);

describe("FactRow", () => {
  it("reads glyph, name, facts, then the marks at its end", () => {
    const html = renderStatic(
      createElement(
        FactRow,
        { glyph: ICONS.plug, name: "notes", mono: true, trailing: mark("KEY") },
        createElement("span", null, "http"),
        createElement("span", null, "https://mcp.example.com/notes"),
      ),
    );
    expect(html).toMatch(/^<li/);
    expect(html.indexOf("<svg")).toBeLessThan(html.indexOf("notes"));
    expect(text(html)).toBe("notes http https://mcp.example.com/notes KEY");
  });

  it("keeps a muted row's name and its trailing mark", () => {
    const html = renderStatic(
      createElement(FactRow, {
        glyph: ICONS.anvil,
        name: "board",
        muted: true,
        trailing: mark("Missing"),
      }),
    );
    expect(text(html)).toBe("board Missing");
    expect(html).toContain('aria-label="Missing"');
  });

  it("closes a row without facts with its marks", () => {
    const html = renderStatic(createElement(FactRow, { name: "notes", trailing: mark("KEY") }));
    expect(text(html)).toBe("notes KEY");
    expect(html.indexOf("notes")).toBeLessThan(html.indexOf("KEY"));
  });
});

describe("FactList", () => {
  it("is a list named by its label, and unnamed without one", () => {
    const row = createElement(FactRow, { name: "notes" });
    expect(renderStatic(createElement(FactList, { label: "MCP servers", children: row }))).toMatch(
      /^<ul[^>]*aria-label="MCP servers"[^>]*><li/,
    );
    expect(renderStatic(createElement(FactList, { children: row }))).not.toContain("aria-label");
  });
});
