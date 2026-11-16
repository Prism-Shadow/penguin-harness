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
import { renderStatic } from "../src/testing";

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
  it("is its own framed box by default, captioned for assistive technology", () => {
    const html = table({ caption: "Schedules", tableClassName: "min-w-[720px]" });
    expect(html).toMatch(/^<div class="ui-frame overflow-x-auto overflow-y-clip /);
    expect(html).toMatch(/<table class="[^"]*">/);
    expect(html).toContain('<caption class="sr-only">Schedules</caption>');
  });

  it("draws no frame when bare", () => {
    const framed = table({});
    expect(framed).toMatch(/<thead><tr class="[^"]*">/);
    expect(framed).toMatch(/<th scope="col" /);
    expect(framed).toMatch(/<th scope="col" class="[^"]*">Cost<\/th>/);
    const bare = table({ framed: false });
    expect(bare).toMatch(/^<div /);
    expect(bare).not.toContain("ui-frame");
  });

  it("sets each figure in its own cell", () => {
    const html = table({});
    expect(html).toMatch(/<td class="[^"]*">\$0\.12<\/td>/);
  });

  it("tightens header and cells together in the small density", () => {
    const html = table({ size: "sm" });
    expect(html).toMatch(/<th scope="col" /);
  });
});
