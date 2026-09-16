/**
 * The handbook explorer's rows, via react-dom/server static markup (node env, no DOM). The
 * explorer is the app's shared `FileTree`, so what is tested here is the handbook's own half:
 * that the rows really are the shared tree's (each one a `treeitem` carrying `data-tree-path`),
 * that the index leads them, and what a row shows on screen against what it only tells the
 * pointer and the screen reader. The pinned index is the case that matters — why `README.md`
 * is pinned is a tooltip and an accessible name, never a second visible line under the file
 * name — while an ordinary document or folder row keeps its visible name as its whole
 * accessible name and carries its own meta after it.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrgHandbookFile } from "@prismshadow/penguin-server/api";
import { HandbookExplorer } from "../src/features/company/handbook-explorer";
import {
  HANDBOOK_INDEX,
  buildHandbookTree,
  handbookTreeRows,
} from "../src/features/company/handbook-tree";
import { formatBytes, formatDateTime, formatRelativeShort } from "../src/lib/format";
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

/**
 * The tree with `roles` open, as one chunk of markup per row in reading order. A row is a
 * `treeitem` element holding no other row — the shared tree nests subtrees in sibling groups —
 * so a row ends at the first close tag after it.
 */
function rows(): string[] {
  const tree = buildHandbookTree(FILES);
  const html = renderToStaticMarkup(
    createElement(HandbookExplorer, {
      rows: handbookTreeRows(tree, new Set(["roles"])),
      selected: HANDBOOK_INDEX,
      locale: "zh",
      toggled: null,
      onSelect: () => undefined,
      onToggle: () => undefined,
    }),
  );
  return [...html.matchAll(/<div [^>]*data-tree-path="[^"]*"[^>]*>.*?<\/div>/g)].map((m) => m[0]);
}

/** One attribute of a row, or null when the row does not carry it. */
const attr = (row: string, name: string): string | null =>
  new RegExp(`${name}="([^"]*)"`).exec(row)?.[1] ?? null;

/** What a row puts on screen: its markup with every tag — and so every attribute — removed. */
const visible = (row: string): string => row.replaceAll(/<[^>]*>/g, "");

describe("HandbookExplorer rows", () => {
  it("draws the shared file tree's rows, the index leading them", () => {
    expect(rows().map((r) => attr(r, "data-tree-path"))).toEqual([
      HANDBOOK_INDEX,
      "roles",
      "roles/eng.md",
      "roles/hr.md",
      "conventions.md",
    ]);
    expect(rows().every((r) => attr(r, "role") === "treeitem")).toBe(true);
  });

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
    const row = rows().find((r) => attr(r, "data-tree-path") === "conventions.md");
    expect(attr(row!, "title")).toBe(`conventions.md · ${updatedAt(40)}`);
    expect(attr(row!, "aria-label")).toBeNull();
    expect(visible(row!)).toBe(`conventions.md${formatRelativeShort(UPDATED, "zh")}`);
  });

  it("gives a folder row its path and how many documents it holds", () => {
    const row = rows().find((r) => attr(r, "aria-expanded") !== null);
    expect(attr(row!, "title")).toBe(`roles · ${zh.company.handbook.documentsInFolder(2)}`);
    expect(attr(row!, "aria-label")).toBeNull();
    expect(visible(row!)).toBe("roles2");
  });
});
