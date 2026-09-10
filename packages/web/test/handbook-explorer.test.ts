/**
 * The handbook explorer's rows, via react-dom/server static markup (node env, no DOM): what a
 * row shows on screen against what it only tells the pointer and the screen reader. The pinned
 * index row is the case that matters — why `README.md` is pinned is a tooltip and an accessible
 * name, never a second visible line under the file name — and the ordinary document and folder
 * rows must keep their visible name as their whole accessible name.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import { HandbookExplorer } from "../src/features/company/handbook-explorer";
import { HANDBOOK_INDEX, buildHandbookTree } from "../src/features/company/handbook-tree";
import { formatBytes, formatDateTime } from "../src/lib/format";
import { zh } from "../src/lib/strings";

const UPDATED = "2026-09-02T10:00:00.000Z";
const file = (path: string, size: number): OrgHandbookFile => ({ path, size, updatedAt: UPDATED });

const FILES = [
  file(HANDBOOK_INDEX, 512),
  file("conventions.md", 40),
  file("roles/hr.md", 30),
  file("roles/eng.md", 30),
];

/** How a document row's tooltip spells "written then, this big". */
const updatedAt = (size: number): string =>
  zh.company.handbook.updatedAt(formatDateTime(UPDATED), formatBytes(size));

/** The tree with `roles` open, as one `<button>` chunk per row in reading order. */
function rows(): string[] {
  const tree = buildHandbookTree(FILES);
  const html = renderToStaticMarkup(
    createElement(HandbookExplorer, {
      index: tree.index,
      nodes: tree.nodes,
      selected: HANDBOOK_INDEX,
      expanded: new Set(["roles"]),
      locale: "zh",
      onSelect: () => undefined,
      onToggle: () => undefined,
    }),
  );
  return html.split("<button").slice(1);
}

/** One attribute of a row, or null when the row does not carry it. */
const attr = (row: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(row)?.[1] ?? null;

/** What a row puts on screen: its markup with every tag — and so every attribute — removed. */
const visible = (row: string): string => `<${row}`.replace(/<[^>]*>/g, "");

describe("HandbookExplorer rows", () => {
  it("keeps the index's reason for being pinned out of the row and in its tooltip and name", () => {
    const [index] = rows();
    const expected = `${HANDBOOK_INDEX} · ${zh.company.handbook.indexLabel} · ${updatedAt(512)}`;
    expect(attr(index!, "title")).toBe(expected);
    expect(attr(index!, "aria-label")).toBe(expected);
    expect(visible(index!)).toContain(HANDBOOK_INDEX);
    expect(visible(index!)).not.toContain(zh.company.handbook.indexLabel);
  });

  it("leaves the index label out of every visible row", () => {
    expect(rows().map(visible).join("")).not.toContain(zh.company.handbook.indexLabel);
  });

  it("gives a document row its path and write time, and no accessible name of its own", () => {
    const row = rows().find((r) => visible(r).includes("conventions.md"));
    expect(attr(row!, "title")).toBe(`conventions.md · ${updatedAt(40)}`);
    expect(attr(row!, "aria-label")).toBeNull();
  });

  it("gives a folder row its path and how many documents it holds", () => {
    const row = rows().find((r) => attr(r, "aria-expanded") !== null);
    expect(attr(row!, "title")).toBe(`roles · ${zh.company.handbook.documentsInFolder(2)}`);
    expect(attr(row!, "aria-label")).toBeNull();
  });
});
