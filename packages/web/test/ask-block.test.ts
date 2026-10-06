import { describe, expect, it } from "vitest";
import {
  composeAskAnswers,
  countAskCards,
  parseAskBlock,
  splitAskBlocks,
} from "../src/features/chat/ask-block";
import type { AskAnswer } from "../src/features/chat/ask-block";

const labels = { other: "其他：", skipped: "跳过，未作答" };

const BODY = [
  "title: 历史图表（Tab 9）优化方向？",
  "select: multi",
  "1. UI/UX：图表样式、颜色、交互体验提升",
  "2. 功能：增加更多图表类型（折线、饼图等）或数据维度",
  "3. 性能：加载速度、渲染优化",
  "recommend: 2",
].join("\n");

describe("parseAskBlock", () => {
  it("reads title, options, numbering and recommendation", () => {
    expect(parseAskBlock(BODY)).toEqual({
      title: "历史图表（Tab 9）优化方向？",
      multi: true,
      options: [
        { index: 1, text: "UI/UX：图表样式、颜色、交互体验提升" },
        { index: 2, text: "功能：增加更多图表类型（折线、饼图等）或数据维度" },
        { index: 3, text: "性能：加载速度、渲染优化" },
      ],
      recommended: [],
    });
  });

  it("keeps the recommendation for a single-choice question", () => {
    const card = parseAskBlock(
      ["title: 选哪个?", "1. 甲", "2. 乙", "3. 丙", "recommend: 3"].join("\n"),
    );
    expect(card?.multi).toBe(false);
    expect(card?.recommended).toEqual([3]);
  });

  it("drops a recommendation that points at no option", () => {
    const card = parseAskBlock(["title: t", "1. 甲", "2. 乙", "recommend: 2, 9"].join("\n"));
    expect(card?.recommended).toEqual([2]);
  });

  it("orders options by their declared number, not by the order they appear", () => {
    const card = parseAskBlock(["title: t", "3. 丙", "1. 甲", "2. 乙"].join("\n"));
    expect(card?.options.map((o) => o.text)).toEqual(["甲", "乙", "丙"]);
  });

  it("accepts the other numberings a model reaches for", () => {
    const card = parseAskBlock(["title: t", "1、甲", "2) 乙"].join("\n"));
    expect(card?.options.map((o) => o.text)).toEqual(["甲", "乙"]);
  });

  it("ignores unknown keys so a later version can add them", () => {
    const card = parseAskBlock(["title: t", "hint: anything", "1. 甲", "2. 乙"].join("\n"));
    expect(card?.title).toBe("t");
  });

  it("needs a title", () => {
    expect(parseAskBlock(["1. 甲", "2. 乙"].join("\n"))).toBeNull();
    expect(parseAskBlock(["title:", "1. 甲", "2. 乙"].join("\n"))).toBeNull();
  });

  it("needs at least two options", () => {
    expect(parseAskBlock(["title: t", "1. 甲"].join("\n"))).toBeNull();
  });

  it("rejects a repeated option number rather than guessing", () => {
    expect(parseAskBlock(["title: t", "1. 甲", "1. 乙"].join("\n"))).toBeNull();
  });

  it("tolerates blank lines and CRLF", () => {
    const card = parseAskBlock("title: t\r\n\r\n1. 甲\r\n2. 乙\r\n");
    expect(card?.options.map((o) => o.text)).toEqual(["甲", "乙"]);
  });
});

describe("splitAskBlocks", () => {
  const wrap = (body: string) =>
    ["下面是我的问题：", "", "```ask", body, "```", "", "以上。"].join("\n");

  it("returns one text segment when there is no card", () => {
    expect(splitAskBlocks("just text")).toEqual([{ kind: "text", text: "just text" }]);
  });

  it("splits the text around a card", () => {
    const segments = splitAskBlocks(wrap(BODY));
    expect(segments.map((s) => s.kind)).toEqual(["text", "ask", "text"]);
    // Text runs are verbatim, blank lines included: Markdown ignores the edges, and rewriting
    // the model's text here would be a second parser nobody asked for.
    expect(segments[0]).toEqual({ kind: "text", text: "下面是我的问题：\n" });
    expect(segments[2]).toEqual({ kind: "text", text: "\n以上。" });
  });

  it("keeps several cards, in order", () => {
    const segments = splitAskBlocks(
      [
        "```ask",
        "title: 一",
        "1. 甲",
        "2. 乙",
        "```",
        "",
        "```ask",
        "title: 二",
        "1. 丙",
        "2. 丁",
        "```",
      ].join("\n"),
    );
    expect(segments.map((s) => s.kind)).toEqual(["ask", "ask"]);
    expect(segments.map((s) => (s.kind === "ask" ? s.card.title : ""))).toEqual(["一", "二"]);
  });

  it("leaves an unterminated fence in the text", () => {
    const text = ["```ask", "title: 一", "1. 甲"].join("\n");
    expect(splitAskBlocks(text)).toEqual([{ kind: "text", text }]);
  });

  it("leaves a body that is not a question in the text", () => {
    const text = ["```ask", "not a question at all", "```"].join("\n");
    expect(splitAskBlocks(text)).toEqual([{ kind: "text", text }]);
  });

  it("does not touch another info string", () => {
    const text = ["```json", "1. 甲", "2. 乙", "```"].join("\n");
    expect(splitAskBlocks(text)).toEqual([{ kind: "text", text }]);
  });

  it("accepts a spaced or capitalized info string", () => {
    const segments = splitAskBlocks(["```  Ask", "title: t", "1. 甲", "2. 乙", "```"].join("\n"));
    expect(segments.map((s) => s.kind)).toEqual(["ask"]);
  });

  it("emits no empty text segment when the message opens with a card", () => {
    const segments = splitAskBlocks(["```ask", "title: t", "1. 甲", "2. 乙", "```"].join("\n"));
    expect(segments.map((s) => s.kind)).toEqual(["ask"]);
  });
});

describe("countAskCards", () => {
  const fence = (title: string): string =>
    ["```ask", `title: ${title}`, "1. 甲", "2. 乙", "```"].join("\n");

  it("counts every card of a message", () => {
    expect(countAskCards(`${fence("一？")}\n\n中间的话\n\n${fence("二？")}`)).toBe(2);
  });

  it("is zero without a fence, and zero for a fence that is not a question", () => {
    expect(countAskCards("一段普通的回复")).toBe(0);
    expect(countAskCards("```ts\nconst a = 1;\n```")).toBe(0);
    expect(countAskCards(["```ask", "title: 只有一项？", "1. 甲", "```"].join("\n"))).toBe(0);
  });
});

describe("composeAskAnswers", () => {
  const answer = (over: Partial<AskAnswer> = {}): AskAnswer => ({
    title: "历史图表（Tab 9）优化方向？",
    choices: [],
    other: "",
    skipped: false,
    ...over,
  });

  it("lists the chosen options under the question", () => {
    expect(composeAskAnswers([answer({ choices: ["性能：加载速度、渲染优化"] })], labels)).toBe(
      "历史图表（Tab 9）优化方向？\n- 性能：加载速度、渲染优化",
    );
  });

  it("appends the free-text row after the choices", () => {
    expect(composeAskAnswers([answer({ choices: ["甲"], other: " 自研 " })], labels)).toBe(
      "历史图表（Tab 9）优化方向？\n- 甲\n- 其他：自研",
    );
  });

  it("records a skipped question instead of dropping it", () => {
    expect(composeAskAnswers([answer({ skipped: true })], labels)).toBe(
      "历史图表（Tab 9）优化方向？\n- 跳过，未作答",
    );
  });

  it("merges a batch into one message, each question titled", () => {
    const text = composeAskAnswers(
      [answer({ choices: ["甲"] }), answer({ title: "第二题", skipped: true })],
      labels,
    );
    expect(text).toBe("历史图表（Tab 9）优化方向？\n- 甲\n\n第二题\n- 跳过，未作答");
  });
});
