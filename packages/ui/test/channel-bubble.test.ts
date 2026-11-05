/**
 * ChannelRun and ChannelBubble (src/components/chat/channel-bubble/channel-bubble.tsx): a sender's
 * run of messages — the avatar and the name once, or only a screen reader's word on the reader's
 * own side — and one message in it, with its time and its side. Its stylesheet is held with every
 * component stylesheet by component-stylesheets.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChannelBubble, ChannelRun } from "../src/components/chat/channel-bubble/channel-bubble";
import type {
  ChannelBubbleProps,
  ChannelRunProps,
} from "../src/components/chat/channel-bubble/channel-bubble";
import { renderStatic } from "../src/testing";

const run = (props: Partial<ChannelRunProps> = {}) =>
  renderStatic(
    createElement(ChannelRun, {
      sender: { kind: "agent", id: "ceo", name: "Chief" },
      children: createElement("p", null, "bubbles"),
      ...props,
    }),
  );

const bubble = (props: Partial<ChannelBubbleProps> = {}) =>
  renderStatic(
    createElement(ChannelBubble, {
      time: "14:05",
      timeLabel: "发送于 9/30 14:05",
      timeTooltip: "9/30 14:05",
      children: createElement("p", null, "body"),
      ...props,
    }),
  );

describe("ChannelRun", () => {
  it("leads somebody else's run with the avatar and the name once, then what follows it", () => {
    const html = run({ meta: createElement("span", null, "Relay · hop 2") });
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain(">Chief</span>");
    expect(html).toContain("Relay · hop 2");
    expect(html.indexOf("Chief")).toBeLessThan(html.indexOf("bubbles"));
    expect(html).not.toContain("sr-only");
  });

  it("draws a person as a decorative initial tile on the foreground ink", () => {
    const html = run({ sender: { kind: "user", id: "u1", name: "dana" } });
    expect(html).toMatch(
      /<span aria-hidden="true" class="[^"]*bg-fg[^"]*text-canvas[^"]*">D<\/span>/,
    );
    expect(html).not.toContain("<svg");
  });

  it("puts the reader's own run on the right, with a screen reader's word for the name", () => {
    const html = run({ own: true, ownLabel: "你" });
    expect(html).toContain('<span class="sr-only">你</span>');
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("Chief");
    // Without a word of its own, the sender's name is what a screen reader hears.
    expect(run({ own: true })).toContain('<span class="sr-only">Chief</span>');
  });
});

describe("ChannelBubble", () => {
  it("prints the body in the compact reading box, the footer under it, the time at its end", () => {
    const html = bubble({ id: "m-1", footer: createElement("span", null, "refs") });
    expect(html).toMatch(/^<div id="m-1" data-side="other" class="channel-bubble /);
    expect(html).toContain('<div class="md-body md-compact"><p>body</p></div><span>refs</span>');
    expect(html).toContain(
      '<span data-tooltip="9/30 14:05" class="absolute bottom-1.5 right-3 text-xs tabular-nums ' +
        'text-tone-neutral-fg"><span class="sr-only">发送于 9/30 14:05</span>' +
        '<span aria-hidden="true">14:05</span></span>',
    );
    expect(html).toContain('<span aria-hidden="true" class="channel-time-gap"></span>');
    expect(bubble()).not.toContain("channel-time-gap");
  });

  it("marks the reader's own bubble as their side", () => {
    const html = bubble({ own: true });
    expect(html).toContain('data-side="own"');
  });
});
