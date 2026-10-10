/**
 * Fence discovery for A2UI blocks (a2ui/fences.ts): CommonMark's fence rules as the checker, the
 * fallback and the renderer rely on them — language from the info string's first word, tildes,
 * longer fences enclosing shorter fence lines, unclosed fences, and indentation.
 */
import { describe, expect, it } from "vitest";
import { findBlocks } from "../src/a2ui/index.js";

describe("findBlocks", () => {
  it("numbers a2ui and mermaid fences from 1 in order, with 1-based fence lines and the body as source", () => {
    const md = [
      "Intro.",
      "",
      "```a2ui",
      '{ "type": "callout" }',
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
    ].join("\n");
    const blocks = findBlocks(md);
    expect(blocks.map((b) => [b.index, b.fence, b.startLine, b.endLine, b.closed])).toEqual([
      [1, "a2ui", 3, 5, true],
      [2, "mermaid", 7, 10, true],
    ]);
    expect(blocks[0]!.source).toBe('{ "type": "callout" }');
    expect(blocks[1]!.source).toBe("flowchart LR\n  A --> B");
  });

  it("takes the language from the first word of the info string, accepts tildes, and ignores other fences", () => {
    const md = '```a2ui json\n{}\n```\n\n```json\n{"type":"choice"}\n```\n\n~~~a2ui\n{}\n~~~\n';
    expect(findBlocks(md).map((b) => [b.index, b.fence, b.info])).toEqual([
      [1, "a2ui", "a2ui json"],
      [2, "a2ui", "a2ui"],
    ]);
  });

  it("a longer fence may contain shorter fence lines, which are then an example rather than a block", () => {
    expect(findBlocks("````markdown\nText.\n```a2ui\n{}\n```\n````\n")).toEqual([]);
  });

  it("an unclosed fence runs to the end of the text and reports closed: false", () => {
    const blocks = findBlocks('Intro.\n```a2ui\n{ "type":');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      closed: false,
      startLine: 2,
      endLine: 3,
      source: '{ "type":',
    });
  });

  it("tolerates up to three spaces of indentation and strips them from the body; four spaces is not a fence", () => {
    const blocks = findBlocks("- item\n  ```a2ui\n  {}\n  ```\n\n    ```a2ui\n    {}\n    ```\n");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.source).toBe("{}");
  });
});
