/**
 * A channel message body, via react-dom/server static markup (node env, no DOM): Markdown
 * renders — headings, lists, tables, fenced code — while the `@mentions` around it stay chips
 * that resolve an employee's name and mark the ones addressing the reader; a mention inside
 * code stays literal; and a single typed newline stays a line break rather than folding into a
 * space, which is what the composer's Shift+Enter promises.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ChannelMessageBody,
  ChannelReaderProvider,
} from "../src/features/company/channel-markdown";
import { zh } from "../src/lib/strings";

const reader = {
  names: new Map([["ceo", "Ada CEO"]]),
  me: "alice",
  employeeIds: new Set(["ceo"]),
};

const render = (text: string) =>
  renderToStaticMarkup(
    createElement(ChannelReaderProvider, {
      reader,
      children: createElement(ChannelMessageBody, { text }),
    }),
  );

describe("channel message Markdown", () => {
  it("renders headings, lists and tables instead of their markers", () => {
    const html = render("## Plan\n\n- one\n- two\n\n| a | b |\n| - | - |\n| 1 | 2 |");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).toContain("<li>one</li>");
    expect(html).toContain("<table>");
    expect(html).not.toContain("## Plan");
  });

  it("keeps a fenced block's content literal, mention included", () => {
    const html = render("```\n@ceo ls\n```");
    expect(html).toContain("@ceo ls");
    expect(html).not.toContain("Ada CEO");
  });

  it("keeps a mention inside inline code literal", () => {
    const html = render("write `@ceo` to reach it");
    expect(html).toContain("<code>@ceo</code>");
    expect(html).not.toContain("Ada CEO");
  });

  it("links open in a new tab", () => {
    const html = render("see [docs](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});

describe("mentions inside a message body", () => {
  it("resolves an employee's name and keeps the raw token in the tooltip", () => {
    const html = render("@ceo 先看一下");
    expect(html).toContain('title="@ceo"');
    expect(html).toContain("@Ada CEO");
    expect(html).not.toContain(zh.company.channels.mentionsYou);
  });

  it("marks a mention that addresses the reader", () => {
    const html = render("@user:alice 这条是给你的");
    expect(html).toContain('title="@user:alice"');
    expect(html).toContain(zh.company.channels.mentionsYou);
  });

  it("survives inside a list item and a heading", () => {
    const html = render("# @ceo\n\n- ping @ceo");
    expect(html).toContain("<h1>");
    expect(html).toContain("<li>");
    expect((html.match(/@Ada CEO/g) ?? []).length).toBe(2);
  });

  it("leaves a message with no mention as one paragraph", () => {
    const html = render("just a note");
    expect(html).toBe("<p>just a note</p>");
  });
});

describe("typed line breaks", () => {
  it("keeps a single newline as a break rather than a space", () => {
    const html = render("first line\nsecond line");
    expect(html).toContain("<br/>");
    expect(html).toContain("first line");
    expect(html).toContain("second line");
  });

  it("still separates paragraphs on a blank line", () => {
    const html = render("one\n\ntwo");
    expect(html).toBe("<p>one</p>\n<p>two</p>");
  });
});
