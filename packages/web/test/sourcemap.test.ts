/**
 * The source map consumer (`features/workbench/sourcemap.ts`). It exists because the panel runs in a
 * sandboxed renderer with no Node and the feature takes no new dependencies, so its correctness has
 * to be pinned here rather than delegated to a library.
 *
 * The maps below are written by hand in VLQ rather than produced by an encoder in this file: a
 * decoder checked against an encoder written by the same person at the same time proves the pair is
 * self-consistent, not that either matches the spec. What cannot be hand-written is the real thing —
 * a Vite module's own inline map — and that is checked on a running dev server in the M3 acceptance.
 */
import { describe, expect, it } from "vitest";
import {
  createConsumer,
  decodeMappings,
  externalSourceMapUrlOf,
  inlineSourceMapOf,
} from "../src/features/workbench/sourcemap";

/**
 * `AAAA;AACA` = line 1: one segment [col 0, source 0, line 0, col 0]; line 2: one segment
 * [col +0, source +0, line +1, col +0]. So line 2's mapping points at the source's second line.
 */
const TWO_LINES = "AAAA;AACA";

describe("decodeMappings", () => {
  it("accumulates the deltas the format is made of", () => {
    const lines = decodeMappings(TWO_LINES);
    expect(lines.map((segments) => segments.length)).toEqual([1, 1]);
    expect(lines[0]?.[0]).toMatchObject({
      genLine: 0,
      genCol: 0,
      source: 0,
      srcLine: 0,
      srcCol: 0,
    });
    // The second line's source line is a delta on the first line's, not an absolute value.
    expect(lines[1]?.[0]).toMatchObject({
      genLine: 1,
      genCol: 0,
      source: 0,
      srcLine: 1,
      srcCol: 0,
    });
  });

  it("keeps a segment with a generated column but no source", () => {
    // `AAAA,A` = line 1: [0,0,0,0] then a bare column delta of 0 — a position with no source.
    const lines = decodeMappings("AAAA,A");
    expect(lines[0]?.[1]).toMatchObject({ genCol: 0, source: null, srcLine: null, srcCol: null });
  });

  it("throws on a character that is not base64", () => {
    expect(() => decodeMappings("AA!A")).toThrow(/invalid base64/);
  });
});

describe("originalPositionFor", () => {
  const consumer = createConsumer({ sources: ["../src/a.ts"], mappings: TWO_LINES });

  it("answers in source-map-js's units: 1-based line in the query, 0-based column", () => {
    expect(consumer.originalPositionFor({ line: 1, column: 0 })).toEqual({
      source: "../src/a.ts",
      line: 1,
      column: 0,
      name: null,
    });
    expect(consumer.originalPositionFor({ line: 2, column: 0 })?.line).toBe(2);
  });

  it("takes the nearest mapping at or before the column (greatest lower bound)", () => {
    // `IAAE` = [col +4, source +0, line +0, col +2]: the source's column 2 starts at generated
    // column 4.
    const wide = createConsumer({ sources: ["a.ts"], mappings: "AAAA,IAAE" });
    // Columns 0..3 are covered by the first segment, 4.. by the second.
    expect(wide.originalPositionFor({ line: 1, column: 0 })?.column).toBe(0);
    expect(wide.originalPositionFor({ line: 1, column: 3 })?.column).toBe(0);
    expect(wide.originalPositionFor({ line: 1, column: 4 })?.column).toBe(2);
  });

  it("refuses to borrow a mapping from another generated line", () => {
    // The line in between has no mapping at all. `node:module` would fall back to the line above;
    // we answer "nothing", because a location that silently belongs to another line is how a
    // wrong line gets reported as exact.
    const gapped = createConsumer({ sources: ["a.ts"], mappings: "AAAA;;AACA" });
    expect(gapped.originalPositionFor({ line: 2, column: 0 })).toEqual({
      source: null,
      line: null,
      column: null,
      name: null,
    });
    expect(gapped.originalPositionFor({ line: 3, column: 0 })?.line).toBe(2);
  });

  it("answers nothing outside the map", () => {
    expect(consumer.originalPositionFor({ line: 99, column: 0 }).source).toBeNull();
    expect(consumer.originalPositionFor({ line: 0, column: 0 }).source).toBeNull();
  });

  it("joins a sourceRoot onto a relative source", () => {
    const rooted = createConsumer({ sourceRoot: "/root", sources: ["a.ts"], mappings: "AAAA" });
    expect(rooted.sources).toEqual(["/root/a.ts"]);
  });
});

describe("inlineSourceMapOf", () => {
  const map = { version: 3, sources: ["a.ts"], mappings: "AAAA" };
  const encoded = Buffer.from(JSON.stringify(map), "utf8").toString("base64");

  it("reads the data-URL map a development build appends", () => {
    const text = `console.log(1);\n//# sourceMappingURL=data:application/json;base64,${encoded}`;
    expect(inlineSourceMapOf(text)?.sources).toEqual(["a.ts"]);
  });

  it("answers null for a module with none, and for one that is not JSON", () => {
    expect(inlineSourceMapOf("console.log(1);")).toBeNull();
    expect(
      inlineSourceMapOf("//# sourceMappingURL=data:application/json;base64,bm90IGpzb24="),
    ).toBeNull();
  });
});

describe("externalSourceMapUrlOf", () => {
  it("names the side-car map a pre-bundled dependency points at", () => {
    // Measured in M3.3: Vite 7 serves `deps/react-markdown.js` with this comment and the map beside it.
    expect(
      externalSourceMapUrlOf("console.log(1);\n//# sourceMappingURL=react-markdown.js.map"),
    ).toBe("react-markdown.js.map");
  });

  it("ignores an inline map, which the other reader owns", () => {
    expect(
      externalSourceMapUrlOf("//# sourceMappingURL=data:application/json;base64,eyJ9"),
    ).toBeNull();
  });

  it("answers null when the module names no map at all", () => {
    expect(externalSourceMapUrlOf("console.log(1);")).toBeNull();
  });

  it("takes the last comment, which is the bundler's own, and tolerates the `@` spelling", () => {
    const text = ["//# sourceMappingURL=inner.js.map", "//@ sourceMappingURL=outer.js.map"].join(
      "\n",
    );
    expect(externalSourceMapUrlOf(text)).toBe("outer.js.map");
  });
});
