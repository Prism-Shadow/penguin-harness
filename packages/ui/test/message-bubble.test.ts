/**
 * MessageRow, MessageBubble, MessageImage and MessageMeta
 * (src/components/chat/message-bubble/message-bubble.tsx): what the person sent, on the right with
 * its footer under it, and the run's one-line notices. Every word arrives as a prop.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ICONS } from "../src/components/icons/icons";
import {
  MessageBubble,
  MessageImage,
  MessageMeta,
  MessageRow,
} from "../src/components/chat/message-bubble/message-bubble";
import { classTokens, renderStatic } from "../src/testing";

describe("MessageRow", () => {
  it("right-aligns a message and is the hover group its footer reveals on", () => {
    const turn = classTokens(renderStatic(createElement(MessageRow, null, "x")));
    expect(turn).toEqual(expect.arrayContaining(["group", "items-end", "my-4"]));
    const steer = classTokens(renderStatic(createElement(MessageRow, { spacing: "steer" }, "x")));
    expect(steer).toContain("my-2");
  });
});

describe("MessageBubble", () => {
  it("sets a prompt's text in a tinted bubble that wraps long tokens", () => {
    const html = renderStatic(createElement(MessageBubble, { variant: "user" }, "hello"));
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-fill-neutral", "max-w-[88%]", "wrap-anywhere", "text-fg"]),
    );
    expect(html).toMatch(/<p [^>]*>hello<\/p><\/div>$/);
  });

  it("marks a steer with the person glyph and its label, with what it carried inside", () => {
    const html = renderStatic(
      createElement(
        MessageBubble,
        {
          variant: "steering",
          label: "Steering",
          media: createElement("img", { alt: "shot" }),
          attachments: createElement("p", null, "a.pdf"),
        },
        "go on",
      ),
    );
    expect(html).toContain(`d="${ICONS.user}"`);
    expect(html).toMatch(/>Steering<\/span>go on<\/p>/);
    expect(html.indexOf('alt="shot"')).toBeLessThan(html.indexOf("a.pdf"));
  });

  it("draws a notice in the muted ink, a reconnect in the attention ink with its controls last", () => {
    const quiet = renderStatic(createElement(MessageBubble, { variant: "notice" }, "Aborted"));
    expect(classTokens(quiet)).toEqual(expect.arrayContaining(["font-mono", "text-fg-muted"]));
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
    expect(classTokens(html)).toContain("text-tone-attention-fg");
    expect(html).toMatch(/<span>Reconnecting<\/span><span [^>]*><button [^>]*>Retry now<\/button>/);
  });
});

describe("MessageImage", () => {
  it("opens large on a click, on the inner radius of the bubble it sits in", () => {
    const html = renderStatic(createElement(MessageImage, { src: "/a.png", alt: "Image" }));
    expect(html).toMatch(/^<button type="button" class="block cursor-zoom-in">/);
    expect(classTokens(html)).toEqual(expect.arrayContaining(["max-h-48", "rounded-control"]));
  });
});

describe("MessageMeta", () => {
  it("shows the time and a copy button named by its label, revealed on the row's hover", () => {
    const html = renderStatic(
      createElement(MessageMeta, { time: "10:24", copy: { text: "hi", label: "Copy message" } }),
    );
    expect(html).toContain(">10:24</span>");
    expect(html).toContain('aria-label="Copy message"');
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["sm:opacity-0", "group-hover:opacity-100", "justify-end"]),
    );
  });

  it("has no copy button when there is nothing to copy", () => {
    expect(renderStatic(createElement(MessageMeta, { time: "10:24" }))).not.toContain("<button");
  });
});
