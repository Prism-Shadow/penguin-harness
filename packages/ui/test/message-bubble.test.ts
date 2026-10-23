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
  it("sets a prompt's text on the accent's tint, in a bubble that wraps long tokens", () => {
    const html = renderStatic(createElement(MessageBubble, { variant: "user" }, "hello"));
    const tokens = classTokens(html);
    expect(tokens).toEqual(
      expect.arrayContaining(["bg-accent-tint", "max-w-[88%]", "wrap-anywhere", "text-fg"]),
    );
    // The person's own words follow the accent; the neutral fill is for what is not theirs.
    expect(tokens).not.toContain("bg-fill-neutral");
    expect(html).toMatch(/<p [^>]*>hello<\/p><\/div>$/);
  });

  it("marks a steer with the person glyph and its label, on the prompt's tint with what it carried inside", () => {
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
    // The same voice as the prompt, with the neutral line a filled box takes; the label is in the
    // body ink, which reads on the tint where the muted ink did not.
    expect(classTokens(html)).toEqual(
      expect.arrayContaining(["bg-accent-tint", "border-line-emphasis"]),
    );
    const label = /<span class="([^"]*)">Steering<\/span>/.exec(html)?.[1]?.split(" ") ?? [];
    expect(label).toContain("text-fg");
    expect(label).not.toContain("text-fg-muted");
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
