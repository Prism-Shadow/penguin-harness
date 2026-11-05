/**
 * StreamText (src/components/chat/stream-text/), the one body streaming text renders through, and
 * the surfaces on it: the assistant reply (AssistantText), a thinking row's text (ThinkingBlock)
 * and a tool call's output (ToolCallCard). Rendered once, without a theme sheet, so the reveal is
 * instant — the pacing itself is stream-reveal.test.ts.
 *
 * - Given text still streaming in, the host is the `ui-stream` host in its `streaming` state with
 *   the caret as its last child, and what the caller appends waits.
 * - Given the stream closed, the host is `done`: no caret, and the caller's extras after the text.
 * - Given plain text, the host is a `<pre>` holding the text verbatim, then the caret.
 * - Given a class that would fight a live tail (the output block's height cap), the host takes it
 *   only once done — a streaming output grows with the transcript.
 * - Given a reply, a thinking row or a tool's output, each body is that same host, so the four
 *   surfaces reveal alike; none carries the app's fixed fade.
 */
import { createElement, isValidElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { AssistantText } from "../src/components/chat/assistant-text/assistant-text";
import { StreamingCaret } from "../src/components/chat/assistant-text/streaming-caret";
import { StreamText } from "../src/components/chat/stream-text/stream-text";
import { ThinkingBlock } from "../src/components/chat/thinking-block/thinking-block";
import { ToolCallCard } from "../src/components/chat/tool-call-card/tool-call-card";
import {
  DISCLOSURE_OUTPUT_CAP_CLASS,
  DISCLOSURE_OUTPUT_CLASS,
} from "../src/components/layout/disclosure-row/disclosure-row";
import { classTokens, renderStatic } from "../src/testing";

const CAP = DISCLOSURE_OUTPUT_CAP_CLASS.split(" ");

const output = (streaming: boolean) =>
  renderStatic(
    createElement(StreamText, {
      format: "plain",
      className: DISCLOSURE_OUTPUT_CLASS,
      settledClassName: DISCLOSURE_OUTPUT_CAP_CLASS,
      text: "$ ls\n**not bold**",
      streaming,
    }),
  );

/**
 * A row's expanded body. The rows start collapsed, and a static render cannot open them, so the
 * body the row would show is rendered from the element the component hands its row.
 */
function bodyOf(row: ReactNode): string {
  if (!isValidElement(row)) throw new Error("the component rendered no row");
  return renderStatic(
    createElement("div", null, (row as ReactElement<{ children?: ReactNode }>).props.children),
  );
}

describe("StreamText", () => {
  it("streams Markdown with the caret as the host's last child, holding the caller's extras back", () => {
    const html = renderStatic(
      createElement(StreamText, { text: "Hello **world**", streaming: true }, "[max_tokens]"),
    );
    expect(html).toMatch(/^<div class="ui-stream" data-state="streaming">/);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toMatch(/<span data-slot="caret"[^>]*>▌<\/span><\/div>$/);
    expect(html).not.toContain("[max_tokens]");
  });

  it("settles to done: no caret, and the extras after the text", () => {
    const html = renderStatic(
      createElement(StreamText, { text: "Hello **world**", streaming: false }, "[max_tokens]"),
    );
    expect(html).toContain('data-state="done"');
    expect(html).not.toContain('data-slot="caret"');
    expect(html).toMatch(/<\/p>\[max_tokens\]<\/div>$/);
  });

  it("streams plain text verbatim in a pre, the caret right after the last character", () => {
    const html = output(true);
    expect(html).toMatch(
      /^<pre class="ui-stream [^"]*" data-state="streaming">\$ ls\n\*\*not bold\*\*<span data-slot="caret"/,
    );
    expect(html).not.toContain("<strong>");
  });

  it("takes the output's height cap only once done, so a streaming output grows", () => {
    const live = classTokens(output(true));
    for (const token of CAP) expect(live).not.toContain(token);
    expect(live).toEqual(expect.arrayContaining(DISCLOSURE_OUTPUT_CLASS.split(" ")));
    const done = classTokens(output(false));
    expect(done).toEqual(expect.arrayContaining(CAP));
  });
});

describe("the surfaces that stream", () => {
  it("a reply is the host on the reply's reading type", () => {
    const html = renderStatic(createElement(AssistantText, { text: "Hi", streaming: true }));
    expect(html).toMatch(/^<div class="ui-stream md-body [^"]*" data-state="streaming">/);
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["font-sans", "text-base", "leading-relaxed", "text-fg"]),
    );
  });

  it("a thinking row's text is the host, without the app's fixed fade", () => {
    const html = bodyOf(
      ThinkingBlock({ state: "running", label: "Thinking", text: "the **plan**" }),
    );
    expect(html).toMatch(/<div class="ui-stream md-body [^"]*" data-state="streaming">/);
    expect(html).toContain("<strong>plan</strong>");
    expect(classTokens(html)).not.toContain("anim-fade");
  });

  it("a tool call's output is the plain host, capped only once the call has settled", () => {
    const card = (outputStreaming: boolean) =>
      bodyOf(
        ToolCallCard({
          state: outputStreaming ? "running" : "done",
          name: "Run command",
          output: "total 0",
          outputStreaming,
        }),
      );
    const live = card(true);
    expect(live).toMatch(
      /<pre class="ui-stream [^"]*" data-state="streaming">total 0<span data-slot="caret"/,
    );
    expect(classTokens(live)).not.toContain("max-h-72");
    expect(classTokens(live)).not.toContain("anim-fade");
    expect(card(false)).toMatch(
      /<pre class="ui-stream [^"]*max-h-72[^"]*" data-state="done">total 0<\/pre>/,
    );
  });
});

describe("StreamingCaret", () => {
  it("is a decorative live caret, pulsing in the subtle ink", () => {
    const html = renderStatic(createElement(StreamingCaret));
    expect(html).toContain('data-slot="caret" data-live="caret" aria-hidden="true"');
    expect(classTokens(html)).toEqual(["animate-pulse", "text-fg-subtle", "ui-live"]);
  });
});
