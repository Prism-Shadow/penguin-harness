/**
 * Markdown tables, as a reader meets them in a chat reply (`Md`) and in a site article
 * (`SiteMarkdown`): each table sits in its own scroll box, and each cell says what it holds, so
 * the stylesheet keeps figures, short cells and code on one line and lets prose wrap.
 *
 * - A table renders inside a scroll box and stays a `<table>`.
 * - A column of figures reads as numbers, its header included; a column of names beside it reads
 *   as short cells.
 * - A dash or "n/a" in a column of figures does not turn it back into text, and carries no kind.
 * - A figure column the author aligned is left to the author: no number kind, the alignment kept.
 * - A cell up to 36 display columns stays on one line and a longer one may wrap, a CJK character
 *   counting two.
 * - A cell with a line break may wrap, however short.
 * - A table has its box and its kinds while the reply still streams, and the settle changes
 *   neither.
 * - A site article boxes its tables with no rehype stage of its own, and boxes a table its host's
 *   own stage produced (the blog's raw HTML), because the pass runs after it.
 * - Running the pass again on a tree it already shaped boxes nothing twice.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  classifyTable,
  rehypeMarkdownTables,
} from "../src/components/content/prose/markdown-table";
import { Md } from "../src/components/content/prose/prose";
import { SiteMarkdown } from "../src/components/site/site-markdown";
import { renderStatic } from "../src/testing";

const reply = (text: string, streaming = false) =>
  renderStatic(createElement(Md, { text, streaming }));

interface RenderedCell {
  tag: string;
  kind: string | undefined;
  style: string | undefined;
  text: string;
}

/** Every rendered cell: its tag, its `data-cell`, its inline style and its text. */
function cells(html: string): RenderedCell[] {
  return [...html.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g)].map(([, tag, attrs, inner]) => ({
    tag: tag!,
    kind: /data-cell="([^"]*)"/.exec(attrs!)?.[1],
    style: /style="([^"]*)"/.exec(attrs!)?.[1],
    text: inner!.replace(/<[^>]*>/g, ""),
  }));
}

/** The kind of the cell whose text is `text`. */
const kindOf = (html: string, text: string) => cells(html).find((cell) => cell.text === text)?.kind;

const PRICES = [
  "| Model | Cost | Latency |",
  "| --- | --- | --- |",
  "| Luna | $0.12 | 12 ms |",
  "| Astra | $1,250.50 | 1,234 ms |",
].join("\n");

describe("a Markdown table in a reply", () => {
  it("renders inside a scroll box and stays a table", () => {
    const html = reply(PRICES);
    expect(html).toContain('<div class="md-table"><table>');
    expect(html.match(/<table/g)).toHaveLength(1);
    expect(html).toContain("</table></div>");
  });

  it("reads a column of figures as numbers, its header included, and names as short cells", () => {
    const html = reply(PRICES);
    for (const text of ["Cost", "$0.12", "$1,250.50", "Latency", "12 ms", "1,234 ms"]) {
      expect(kindOf(html, text)).toBe("num");
    }
    for (const text of ["Model", "Luna", "Astra"]) expect(kindOf(html, text)).toBe("short");
  });

  it("keeps a column of figures numeric past a dash or an n/a, which carry no kind", () => {
    const html = reply(
      ["| Run | Score |", "| --- | --- |", "| a | 40% |", "| b | — |", "| c | n/a |"].join("\n"),
    );
    expect(kindOf(html, "Score")).toBe("num");
    expect(kindOf(html, "40%")).toBe("num");
    expect(kindOf(html, "—")).toBeUndefined();
    expect(kindOf(html, "n/a")).toBeUndefined();
  });

  it("does not read versions, dates or ratios as figures", () => {
    const html = reply(
      ["| Release | Date | Share |", "| --- | --- | --- |", "| v1.2.3 | 2024-01-01 | 1/2 |"].join(
        "\n",
      ),
    );
    for (const text of ["Release", "v1.2.3", "Date", "2024-01-01", "Share", "1/2"]) {
      expect(kindOf(html, text)).toBe("short");
    }
  });

  it("leaves a figure column the author aligned to the author", () => {
    const html = reply(["| Name | Cost |", "| --- | :--- |", "| Luna | 12 |"].join("\n"));
    const cost = cells(html).filter((cell) => cell.text === "Cost" || cell.text === "12");
    expect(cost.map((cell) => cell.kind)).toEqual(["short", "short"]);
    for (const cell of cost) expect(cell.style).toBe("text-align:left");
  });

  it("keeps a cell of up to 36 display columns on one line, a CJK character counting two", () => {
    const latin = (n: number) => "a".repeat(n);
    const cjk = (n: number) => "表".repeat(n);
    const html = reply(
      [
        "| Text |",
        "| --- |",
        `| ${latin(36)} |`,
        `| ${latin(37)} |`,
        `| ${cjk(18)} |`,
        `| ${cjk(19)} |`,
      ].join("\n"),
    );
    expect(kindOf(html, latin(36))).toBe("short");
    expect(kindOf(html, latin(37))).toBe("prose");
    expect(kindOf(html, cjk(18))).toBe("short");
    expect(kindOf(html, cjk(19))).toBe("prose");
  });

  it("lets a cell with a line break wrap, however short", () => {
    const cell = {
      type: "element",
      tagName: "td",
      properties: {},
      children: [
        { type: "text", value: "a" },
        { type: "element", tagName: "br", properties: {}, children: [] },
        { type: "text", value: "b" },
      ],
    };
    const table = {
      type: "element",
      tagName: "table",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "tbody",
          properties: {},
          children: [{ type: "element", tagName: "tr", properties: {}, children: [cell] }],
        },
      ],
    };
    classifyTable(table);
    expect(cell.properties).toEqual({ dataCell: "prose" });
  });

  it("has its box and its kinds while the reply streams, and the settle changes neither", () => {
    const table = (html: string) =>
      /<div class="md-table">[\s\S]*?<\/table><\/div>/.exec(html)?.[0];
    const streaming = table(reply(PRICES, true));
    expect(streaming).toBeDefined();
    expect(kindOf(streaming!, "$0.12")).toBe("num");
    expect(table(reply(PRICES))).toBe(streaming);
  });
});

describe("a Markdown table in a site article", () => {
  const article = (rehypePlugins?: Parameters<typeof SiteMarkdown>[0]["rehypePlugins"]) =>
    renderStatic(createElement(SiteMarkdown, { variant: "doc", rehypePlugins, children: PRICES }));

  it("is boxed and classified with no rehype stage from the host", () => {
    const html = article();
    expect(html).toContain('<div class="md-table"><table>');
    expect(kindOf(html, "1,234 ms")).toBe("num");
  });

  it("is boxed after the host's own stage, so a table that stage produced is shaped too", () => {
    // Stands in for the blog's rehype-raw: a host stage that adds a table of its own.
    const addTable = () => (tree: { children: unknown[] }) => {
      tree.children.push({
        type: "element",
        tagName: "table",
        properties: {},
        children: [
          {
            type: "element",
            tagName: "tbody",
            properties: {},
            children: [
              {
                type: "element",
                tagName: "tr",
                properties: {},
                children: [
                  {
                    type: "element",
                    tagName: "td",
                    properties: {},
                    children: [{ type: "text", value: "raw" }],
                  },
                ],
              },
            ],
          },
        ],
      });
    };
    const html = article([addTable]);
    expect(html.match(/<div class="md-table"><table>/g)).toHaveLength(2);
    expect(kindOf(html, "raw")).toBe("short");
  });
});

describe("the table pass", () => {
  it("boxes nothing twice when it runs again on a tree it already shaped", () => {
    const table = { type: "element", tagName: "table", properties: {}, children: [] };
    const tree = { type: "root", children: [table] };
    const pass = rehypeMarkdownTables();
    pass(tree);
    pass(tree);
    expect(tree.children).toHaveLength(1);
    const box = tree.children[0] as { tagName?: string; children?: unknown[] };
    expect(box.tagName).toBe("div");
    expect(box.children).toEqual([table]);
  });
});
