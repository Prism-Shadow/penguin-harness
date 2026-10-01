/**
 * AssistantText and StreamingCaret (src/components/chat/assistant-text/): the reply body is the
 * `ui-stream` host, streaming with the caret as its last child until the reply is whole, and
 * holding back whatever the caller appends until then. Rendered once, without a theme sheet, so
 * the reveal is instant — the pacing itself is stream-reveal.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AssistantText } from "../src/components/chat/assistant-text/assistant-text";
import { StreamingCaret } from "../src/components/chat/assistant-text/streaming-caret";
import { classTokens, renderStatic } from "../src/testing";

const reply = (streaming: boolean) =>
  renderStatic(
    createElement(AssistantText, { text: "Hello **world**", streaming }, "[max_tokens]"),
  );

describe("AssistantText", () => {
  it("streams with the caret as the host's last child, and holds the caller's extras back", () => {
    const html = reply(true);
    expect(html).toMatch(/^<div class="ui-stream md-body [^"]*" data-state="streaming">/);
    expect(html).toContain("<strong>world</strong>");
    expect(html).toMatch(/<span data-slot="caret"[^>]*>▌<\/span><\/div>$/);
    expect(html).not.toContain("[max_tokens]");
  });

  it("settles to done: no caret, and the extras after the text", () => {
    const html = reply(false);
    expect(html).toContain('data-state="done"');
    expect(html).not.toContain('data-slot="caret"');
    expect(html).toMatch(/<\/p>\[max_tokens\]<\/div>$/);
  });
});

describe("StreamingCaret", () => {
  it("is a decorative live caret, pulsing in the subtle ink", () => {
    const html = renderStatic(createElement(StreamingCaret));
    expect(html).toContain('data-slot="caret" data-live="caret" aria-hidden="true"');
    expect(classTokens(html)).toEqual(["animate-pulse", "text-fg-subtle", "ui-live"]);
  });
});
