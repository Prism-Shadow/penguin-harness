/**
 * A page under another page: `PageData.parent` (web-app/page-table.ts) and how the nav groups
 * it (web-app/sidebar/nav-state.ts).
 *
 * - parentedPagesOf keeps a child whose parent is in the table and drops one whose parent is
 *   absent, one whose parent sits under another page (one level only — the parent stays), and
 *   one naming itself; a table without parents comes back as it is.
 * - The nav's entries are the top-level pages; each entry's children follow it in table order,
 *   offered like entries (unreleased to nobody, admin-only to admins), and are never entries of
 *   their own, so they take no part in the pinned/collapsible split.
 */
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { parentedPagesOf, type WebAppPage } from "../src/web-app/page-table";

import { navChildKeysFor, navEntryKeysFor, navKeysFor } from "../src/web-app/sidebar/nav-state";

const Blank: ComponentType = () => null;

function page(key: string, extra: Partial<WebAppPage> = {}): WebAppPage {
  return {
    id: `${key}.page`,
    key,
    path: `/${key}`,
    frame: "shell",
    nav: "main",
    admin: false,
    released: true,
    order: 0,
    Component: Blank,
    ...extra,
  };
}

describe("parentedPagesOf", () => {
  it("returns a table without parents as it is", () => {
    const table = [page("agents"), page("benchmark")];
    expect(parentedPagesOf(table)).toBe(table);
  });

  it("keeps a child whose parent is in the table", () => {
    const table = [page("benchmark"), page("hello", { parent: "benchmark" })];
    expect(parentedPagesOf(table).map((p) => p.key)).toEqual(["benchmark", "hello"]);
  });

  it("drops a child whose parent is absent, so it is neither in the nav nor routed", () => {
    const table = [page("agents"), page("hello", { parent: "benchmark" })];
    expect(parentedPagesOf(table).map((p) => p.key)).toEqual(["agents"]);
  });

  it("refuses a child whose parent sits under another page, and keeps that parent", () => {
    const table = [
      page("benchmark"),
      page("hello", { parent: "benchmark" }),
      page("deeper", { parent: "hello" }),
    ];
    expect(parentedPagesOf(table).map((p) => p.key)).toEqual(["benchmark", "hello"]);
  });

  it("drops a page that names itself as its parent", () => {
    const table = [page("agents"), page("loop", { parent: "loop" })];
    expect(parentedPagesOf(table).map((p) => p.key)).toEqual(["agents"]);
  });
});

describe("the nav's children", () => {
  const pages = [
    page("agents"),
    page("benchmark"),
    page("hello", { parent: "benchmark" }),
    page("later", { parent: "benchmark", released: false }),
    page("ops", { parent: "benchmark", admin: true }),
    page("second", { parent: "benchmark" }),
    page("machines", { admin: true }),
    page("tool", { parent: "machines" }),
  ];

  it("entries are the top-level pages only", () => {
    expect(navKeysFor(pages, true)).toEqual(["agents", "benchmark", "machines"]);
    expect(navEntryKeysFor(pages, false)).toEqual(["newChat", "agents", "benchmark"]);
  });

  it("each entry carries its children in table order, offered like entries", () => {
    expect([...navChildKeysFor(pages, true)]).toEqual([
      ["benchmark", ["hello", "ops", "second"]],
      ["machines", ["tool"]],
    ]);
    // A member is offered neither the admin-only child nor, through its parent, the other.
    const member = navChildKeysFor(pages, false);
    expect(member.get("benchmark")).toEqual(["hello", "second"]);
    expect(navKeysFor(pages, false)).not.toContain("machines");
  });
});
