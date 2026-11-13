import { describe, expect, it } from "vitest";
import {
  SEGMENT_SEPARATOR,
  indexableProjection,
  queryExpression,
  queryNeedles,
  snippetAround,
} from "../src/services/search-text.js";

/** The projection, with the separator rendered as "|" so an expectation can be read. */
const shown = (text: string): string =>
  indexableProjection(text).replaceAll(SEGMENT_SEPARATOR, "|");

describe("indexableProjection", () => {
  it("expands a CJK run into unigrams and bigrams", () => {
    expect(shown("软著提交")).toBe("|软|软著|著|著提|提|提交|交|");
  });

  it("leaves latin and digits alone", () => {
    expect(shown("ERP 16:9")).toBe("ERP 16:9");
  });

  it("separates a latin run from a CJK run, which unicode61 would otherwise fuse", () => {
    expect(shown("ERP软著")).toBe("ERP|软|软著|著|");
  });

  it("keeps every non-CJK character exactly where it was", () => {
    // The projection is lossy by design (bigrams repeat characters), so the guarantee is
    // one-directional: stripping the separators leaves every latin/digit/punctuation run
    // untouched, which is what the latin tokens in the index are built from.
    const stripped = (text: string): string =>
      indexableProjection(text).replaceAll(SEGMENT_SEPARATOR, "");
    for (const text of ["a\nb\t纯 ASCII line", "  spaced  ", ""]) {
      expect(stripped(text)).toBe(text);
    }
  });
});

describe("queryExpression", () => {
  it("turns a two-character Chinese query into an adjacent-piece phrase", () => {
    // Unigram + bigram pieces: the phrase still requires the characters to be adjacent,
    // which is what makes "软著" match "软著" and not "著作".
    expect(queryExpression("软著")).toBe('"软 软著 著"');
  });

  it("keeps a three-character Chinese query's pieces in order", () => {
    expect(queryExpression("软著补")).toBe('"软 软著 著 著补 补"');
  });

  it("quotes a latin term so punctuation cannot become FTS5 syntax", () => {
    expect(queryExpression("a.b")).toBe('"ab"');
  });

  it("ANDs whitespace-separated terms", () => {
    expect(queryExpression("软著 ERP")).toBe('"软 软著 著" AND "ERP"');
  });

  it("ANDs the runs of one mixed term", () => {
    expect(queryExpression("ERP软著")).toBe('"ERP" AND "软 软著 著"');
  });

  it("is empty for a query with nothing a token can match", () => {
    expect(queryExpression("  ···  ")).toBe("");
  });
});

describe("queryNeedles", () => {
  it("keeps a CJK run whole and strips latin punctuation", () => {
    expect(queryNeedles("ERP软著 提交")).toEqual(["ERP", "软著", "提交"]);
    expect(queryNeedles("a.b")).toEqual(["ab"]);
  });
});

describe("snippetAround", () => {
  it("marks every needle inside the excerpt and returns excerpt-local offsets", () => {
    const snip = snippetAround("今天早上我提交了一个 ERP软著 到版权中心", ["软著", "提交"]);
    expect(snip.text).toContain("软著");
    expect(snip.marks.length).toBeGreaterThanOrEqual(2);
    for (const [a, b] of snip.marks) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(snip.text.length);
      expect(b).toBeGreaterThan(a);
    }
    // Every marked range really is a needle.
    for (const [a, b] of snip.marks) {
      expect(["软著", "提交"]).toContain(snip.text.slice(a, b));
    }
  });

  it("collapses newlines and keeps the marked text aligned with the returned excerpt", () => {
    const snip = snippetAround("第一行\n第二行 软著", ["软著"]);
    expect(snip.text).not.toContain("\n");
    expect(snip.text.slice(snip.marks[0]![0], snip.marks[0]![1])).toBe("软著");
  });

  it("falls back to the head when no literal occurrence exists", () => {
    const snip = snippetAround("没有任何命中", ["软著"]);
    expect(snip.marks).toEqual([]);
    expect(snip.text).toBe("没有任何命中");
  });
});
