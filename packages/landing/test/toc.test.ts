import { describe, expect, it } from "vitest";
import { extractToc, slugifyHeading } from "../src/lib/toc";

describe("blog toc", () => {
  it("slugifies latin and CJK headings consistently", () => {
    expect(slugifyHeading("Why PenguinHarness")).toBe("why-penguinharness");
    expect(slugifyHeading("为什么是 PenguinHarness")).toBe("为什么是-penguinharness");
  });

  it("extracts h2/h3 headings and skips fenced code blocks", () => {
    const body = [
      "intro",
      "## 第一节",
      "```bash",
      "## not a heading",
      "```",
      "### 小节",
      "## Second",
    ].join("\n");
    expect(extractToc(body)).toEqual([
      { id: "第一节", text: "第一节", depth: 2 },
      { id: "小节", text: "小节", depth: 3 },
      { id: "second", text: "Second", depth: 2 },
    ]);
  });
});
