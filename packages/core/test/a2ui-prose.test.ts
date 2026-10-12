/**
 * The STE-lite prose lint (a2ui/prose.ts): each rule's true positive, and the negatives that
 * keep it from firing on correct text — code, fences, tables, URLs and headings are skipped,
 * file names and abbreviations do not split sentences, adjectives are not passives, the plain
 * quantifiers are not vague words. Both languages, and the auto detection between them.
 */
import { describe, expect, it } from "vitest";
import { detectLang, lintProse } from "../src/a2ui/index.js";
import { splitSentences } from "../src/a2ui/prose.js";

const codes = (markdown: string, lang?: "zh" | "en") =>
  lintProse(markdown, lang ? { lang } : {}).map((issue) => issue.code);

describe("lintProse (en)", () => {
  it("flags a sentence over 25 words, with its line", () => {
    const long =
      "This sentence keeps going with one more clause and then another clause and yet another clause until it passes the limit of twenty five words easily.";
    const issues = lintProse(`Short one.\n\n${long}`);
    expect(issues.map((i) => [i.code, i.line])).toEqual([["long_sentence", 3]]);
  });

  it("flags the passive voice but not adjectives, colours or 'indeed'", () => {
    expect(codes("The file is written by the loader.")).toEqual(["passive_voice"]);
    expect(codes("The config can be changed later.")).toEqual(["passive_voice"]);
    expect(
      codes(
        "The light is red. This is indeed the case. We are interested in speed. The loader reads the file.",
      ),
    ).toEqual([]);
  });

  it("flags vague words, but not the plain quantifier 'some'", () => {
    expect(codes("Fix the config files, logs, etc.")).toEqual(["vague_word"]);
    expect(codes("Choose an appropriate value and various other things.")).toEqual([
      "vague_word",
      "vague_word",
      "vague_word",
    ]);
    expect(codes("Some files changed.")).toEqual([]);
  });

  it("flags a paragraph of more than 5 sentences and a list nested 3 deep", () => {
    expect(codes("One. Two. Three. Four. Five. Six.")).toEqual(["long_paragraph"]);
    expect(codes("- a\n  - b\n    - c\n")).toEqual(["deep_nesting"]);
    expect(codes("- a\n  - b\n- c\n")).toEqual([]);
  });

  it("flags a paragraph of more than 800 characters with no break it could split", () => {
    const wall = "word ".repeat(201).trim();
    const found = codes(wall);
    expect(found).toContain("wall_of_text");
    expect(found).not.toContain("long_paragraph");
  });

  it("skips code spans, fences, tables, URLs and headings", () => {
    const thirty = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    expect(codes(`Run \`${thirty}\` now.`)).toEqual([]);
    expect(codes(`\`\`\`\n${thirty}\n\`\`\``)).toEqual([]);
    expect(codes(`| a | b |\n| --- | --- |\n| ${thirty} | x |`)).toEqual([]);
    expect(codes(`See https://example.com/${"a/".repeat(60)}end.`)).toEqual([]);
    expect(codes(`# ${thirty}`)).toEqual([]);
  });

  it("does not split a sentence at a file name, an abbreviation or a version number", () => {
    expect(
      splitSentences(
        "Run check.mjs on the draft. Then fix e.g. the errors. Send v1.2 now.",
        "en",
      ).map((s) => s.text),
    ).toEqual(["Run check.mjs on the draft.", "Then fix e.g. the errors.", "Send v1.2 now."]);
  });
});

describe("lintProse (zh) and language detection", () => {
  it("picks zh when CJK dominates the prose, en otherwise", () => {
    expect(detectLang("这是一个中文句子。")).toBe("zh");
    expect(detectLang("Plain English with 中文 words.")).toBe("en");
    expect(detectLang("```a2ui\n{}\n```")).toBe("en");
  });

  it("flags a sentence over 60 characters and the padding verb 进行, but not 一些", () => {
    expect(codes(`${"长".repeat(61)}。`)).toEqual(["long_sentence"]);
    expect(codes("请对配置进行修改。")).toEqual(["vague_word"]);
    expect(codes("改了一些文件。")).toEqual([]);
    expect(codes("下面是把数据目录迁到新磁盘的步骤。")).toEqual([]);
  });

  it("applies the chosen language's rules when lang is given", () => {
    // Under en rules this is one 7-word sentence; under zh rules its 40 characters are also fine.
    expect(codes("The loader reads the file at startup.", "zh")).toEqual([]);
    expect(codes("请对配置进行修改。", "en")).toEqual([]);
  });
});
