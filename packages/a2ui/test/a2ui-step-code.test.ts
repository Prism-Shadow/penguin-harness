/**
 * Given a step containing Markdown examples, when its text fallback is generated, the entire
 * example remains one code block rather than ending at an embedded backtick fence.
 * Given ordinary code, the same fallback keeps its language and code unchanged.
 */
import { describe, expect, it } from "vitest";
import { toFallbackMarkdown } from "../src/index.js";
import { scanFences } from "../src/fences.js";

describe("step code in the text fallback", () => {
  it.each([
    "echo hello",
    "```js\nconsole.log('hello')\n```\nKeep this inside code.",
    "````\n```\n````\nStill code.",
    "const example = `inline`;",
  ])("keeps the complete snippet inside one code block: %s", (code) => {
    const spec = { type: "steps", steps: [{ text: "Read the example.", code, lang: "md" }] };
    const markdown = toFallbackMarkdown(`~~~a2ui\n${JSON.stringify(spec)}\n~~~`);
    const blocks = scanFences(markdown);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.closed).toBe(true);
    expect(blocks[0]?.lang).toBe("md");
    expect(blocks[0]?.body.join("\n")).toBe(code);
  });
});
