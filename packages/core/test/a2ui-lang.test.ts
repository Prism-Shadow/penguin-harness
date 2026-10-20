/**
 * Which language a reply is in (a2ui/lang.ts): the text fallback words its blocks in it and the
 * checker prints its rubric in it.
 *
 * - Given a reply whose text is mostly Chinese, it is zh; mostly English with a few Chinese
 *   words, it is en.
 * - Given a reply that is only a fence, it is en: what a block holds is not the reply's text.
 * - Inline code and URLs do not count, so a Chinese sentence around a long command or link stays zh.
 * - Given an explicit language, it wins over the detection; `auto` detects.
 */
import { describe, expect, it } from "vitest";
import { detectLang } from "../src/a2ui/index.js";
import { resolveLang } from "../src/a2ui/lang.js";

describe("detectLang", () => {
  it("is zh when CJK dominates the text, en otherwise", () => {
    expect(detectLang("这是一个中文句子。")).toBe("zh");
    expect(detectLang("Plain English with 中文 words.")).toBe("en");
  });

  it("does not read what a fence holds", () => {
    expect(detectLang('```a2ui\n{"type":"callout","tone":"note","text":"说明"}\n```')).toBe("en");
    expect(detectLang("Pick one.\n\n```text\n这是代码块里的中文，很长很长很长\n```")).toBe("en");
  });

  it("leaves inline code and URLs out of the count", () => {
    expect(detectLang("运行 `node scripts/check.mjs /tmp/a2ui-draft.md --rubric` 即可。")).toBe(
      "zh",
    );
    expect(detectLang("详见 https://example.com/some/very/long/path/to/the/page")).toBe("zh");
  });
});

describe("resolveLang", () => {
  it("an explicit language wins; auto and none detect", () => {
    expect(resolveLang("这是一个中文句子。", "en")).toBe("en");
    expect(resolveLang("Plain English.", "zh")).toBe("zh");
    expect(resolveLang("这是一个中文句子。", "auto")).toBe("zh");
    expect(resolveLang("Plain English.")).toBe("en");
  });
});
