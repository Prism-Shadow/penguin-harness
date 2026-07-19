import { describe, expect, it } from "vitest";
import { extractToc, slugifyHeading } from "../src/lib/toc";

describe("slugifyHeading", () => {
  it("lowercases latin, hyphenates spaces, keeps CJK", () => {
    expect(slugifyHeading("Agent Loop")).toBe("agent-loop");
    expect(slugifyHeading("消息信封")).toBe("消息信封");
    expect(slugifyHeading("Tool Calls (streaming)")).toBe("tool-calls-streaming");
  });
});

describe("extractToc", () => {
  it("collects ##/### headings and skips fenced code blocks", () => {
    const body = [
      "## Envelope",
      "```ts",
      "## not a heading",
      "```",
      "### Payload kinds",
      "#### too deep",
    ].join("\n");
    expect(extractToc(body)).toEqual([
      { id: "envelope", text: "Envelope", depth: 2 },
      { id: "payload-kinds", text: "Payload kinds", depth: 3 },
    ]);
  });
});
