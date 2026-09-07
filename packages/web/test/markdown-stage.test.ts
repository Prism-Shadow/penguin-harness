/**
 * The on-demand math stage (lib/markdown-plugins.ts): which bodies ask for KaTeX at all, and
 * that the load is one import for the page however many ask.
 */
import { describe, expect, it } from "vitest";
import { NO_REHYPE_PLUGINS, hasMath, loadKatexStage } from "../src/lib/markdown-plugins";

describe("hasMath", () => {
  it("sees the three delimiters the remark stage accepts", () => {
    expect(hasMath("$$x^2$$")).toBe(true);
    expect(hasMath("so \\(x\\) here")).toBe(true);
    expect(hasMath("\\[\\int f\\]")).toBe(true);
  });

  it("does not see prose, prices or shell variables as math", () => {
    expect(hasMath("Set $PATH and $HOME before running.")).toBe(false);
    expect(hasMath("It costs $5 and $10 in total.")).toBe(false);
    expect(hasMath("a (b) [c]")).toBe(false);
    expect(hasMath("")).toBe(false);
  });
});

describe("loadKatexStage", () => {
  it("is one import for the page", async () => {
    const first = loadKatexStage();
    expect(loadKatexStage()).toBe(first);
    await first;
  });

  it("keeps the empty stage a stable identity", () => {
    expect(NO_REHYPE_PLUGINS).toBe(NO_REHYPE_PLUGINS);
    expect(NO_REHYPE_PLUGINS).toHaveLength(0);
  });
});
