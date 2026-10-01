/**
 * The Table family: one header style (the small rung, medium weight, muted ink, a token rule; the
 * muted strip only on a framed table, which is a `ui-frame` host), column headers scoped to their
 * columns, and cells that share the header's padding per density.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../src/components/data/table/table";
import type { TableProps } from "../src/components/data/table/table";
import { classTokens, renderStatic } from "../src/testing";

const table = (props: Partial<TableProps>): string =>
  renderStatic(
    createElement(
      Table,
      props,
      createElement(
        TableHead,
        null,
        createElement(TableHeaderCell, null, "Name"),
        createElement(TableHeaderCell, { align: "right" }, "Cost"),
      ),
      createElement(
        TableBody,
        null,
        createElement(
          TableRow,
          null,
          createElement(TableCell, null, "alpha"),
          createElement(TableCell, { numeric: true }, "$0.12"),
        ),
      ),
    ),
  );

describe("Table", () => {
  it("is its own framed box by default, scrolling sideways, on tokens", () => {
    const html = table({ caption: "Schedules", tableClassName: "min-w-[720px]" });
    expect(html).toMatch(/^<div class="ui-frame overflow-x-auto overflow-y-clip /);
    expect(html).toMatch(/<table class="w-full text-left text-sm min-w-\[720px\]">/);
    expect(html).toContain('<caption class="sr-only">Schedules</caption>');
    expect(html).not.toMatch(/gray-|dark:/);
  });

  it("heads its columns in one style, with the strip only when framed", () => {
    const framed = table({});
    expect(framed).toMatch(
      /<thead><tr class="border-b border-line text-xs text-fg-muted bg-surface-muted">/,
    );
    expect(framed).toMatch(/<th scope="col" class="[^"]*font-medium text-left/);
    expect(framed).toMatch(/<th scope="col" class="[^"]*text-right[^"]*">Cost<\/th>/);
    const bare = table({ framed: false });
    expect(bare).toMatch(/^<div class="overflow-x-auto /);
    expect(bare).not.toContain("ui-frame");
    expect(bare).toContain('<tr class="border-b border-line text-xs text-fg-muted ">');
  });

  it("rules and lightens its rows, and sets figures right and tabular", () => {
    const html = table({});
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["border-line-muted", "last:border-b-0", "hover:bg-surface-muted"]),
    );
    expect(html).toMatch(/<td class="px-3 py-2 text-right tabular-nums *">\$0\.12<\/td>/);
  });

  it("tightens header and cells together in the small density", () => {
    const html = table({ size: "sm" });
    expect(html).toMatch(/<table class="w-full text-left text-xs/);
    expect(html).toMatch(/<th scope="col" class="px-2 py-1\.5 /);
    expect(html).toMatch(/<td class="px-2 py-1\.5 /);
  });
});
