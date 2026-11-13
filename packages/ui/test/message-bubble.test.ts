/**
 * MessageRow, MessageBubble and MessageMeta
 * (src/components/chat/message-bubble/message-bubble.tsx): what the person sent, on the right with
 * its footer under it, and the run's one-line notices. Every word arrives as a prop.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import {
  MessageBubble,
  MessageMeta,
  MessageRow,
} from "../src/components/chat/message-bubble/message-bubble";
import { markupStructure, renderStatic } from "../src/testing";

describe("MessageBubble", () => {
  it("sets a prompt's text in its bubble", () => {
    const html = renderStatic(createElement(MessageBubble, { variant: "user" }, "hello"));
    // The person's own words follow the accent; the neutral fill is for what is not theirs.
    expect(html).toMatch(/<p [^>]*>hello<\/p><\/div>$/);
  });

  it("marks a steer with the person glyph and its label, with what it carried inside", () => {
    const html = renderStatic(
      createElement(
        MessageBubble,
        {
          variant: "steering",
          label: "Steering",
          attachments: createElement("p", null, "a.pdf"),
        },
        "go on",
      ),
    );
    expect(html).toContain(`d="${ICONS.user}"`);
    expect(html).toMatch(/>Steering<\/span>go on<\/p>/);
    expect(html.indexOf("go on")).toBeLessThan(html.indexOf("a.pdf"));
  });

  it("draws a plain notice as its text alone, with no controls", () => {
    const html = renderStatic(createElement(MessageBubble, { variant: "notice" }, "Aborted"));
    expect(markupStructure(html)).toMatch(/^<p>.*Aborted.*<\/p>$/s);
    expect(html).not.toContain("<button");
  });

  it("draws a reconnect notice with its controls last", () => {
    const html = renderStatic(
      createElement(
        MessageBubble,
        {
          variant: "notice",
          tone: "attention",
          actions: createElement("button", { type: "button" }, "Retry now"),
        },
        createElement("span", null, "Reconnecting"),
      ),
    );
    expect(html).toMatch(
      />Reconnecting<\/span><\/span><span [^>]*><button [^>]*>Retry now<\/button>/,
    );
  });
});

describe("MessageRow", () => {
  it("holds the message, then its footer", () => {
    const html = renderStatic(
      createElement(
        MessageRow,
        null,
        createElement("p", null, "hello"),
        createElement("i", null, "10:24"),
      ),
    );
    expect(markupStructure(html)).toBe("<div><p>hello</p><i>10:24</i></div>");
  });
});

describe("MessageMeta", () => {
  it("shows the time and a copy button named by its label", () => {
    const html = renderStatic(
      createElement(MessageMeta, { time: "10:24", copy: { text: "hi", label: "Copy message" } }),
    );
    expect(html).toContain(">10:24</span>");
    expect(html).toContain('aria-label="Copy message"');
  });

  it("has no copy button when there is nothing to copy", () => {
    expect(renderStatic(createElement(MessageMeta, { time: "10:24" }))).not.toContain("<button");
  });
});
