/**
 * ChannelRun and ChannelBubble (src/components/chat/channel-bubble/channel-bubble.tsx): a sender's
 * run of messages — the avatar and the name once, or only a screen reader's word on the reader's
 * own side — and one message in it, with its time, its tail corner and its surface; and the
 * stylesheet that deepens inline code and table rules inside it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ChannelBubble, ChannelRun } from "../src/components/chat/channel-bubble/channel-bubble";
import type {
  ChannelBubbleProps,
  ChannelRunProps,
} from "../src/components/chat/channel-bubble/channel-bubble";
import { classTokens, renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

const DIR = join(SRC_DIR, "components/chat/channel-bubble");
const read = (name: string) => readFileSync(join(DIR, name), "utf8");

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
    expect(classTokens(html)).toEqual(expect.arrayContaining(["items-start", "text-fg-muted"]));
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
    expect(classTokens(html)).toContain("items-end");
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
      '<span data-tooltip="9/30 14:05" class="shrink-0 text-xs tabular-nums ' +
        'text-tone-neutral-fg"><span class="sr-only">发送于 9/30 14:05</span>' +
        '<span aria-hidden="true">14:05</span></span>',
    );
    expect(classTokens(html)).toEqual(expect.arrayContaining(["bg-fill-neutral", "text-fg"]));
  });

  it("squares the corner nearest the run's tail, on the last bubble only", () => {
    const tokens = (own: boolean, last: boolean) => classTokens(bubble({ own, last }));
    expect(tokens(false, false)).toContain("rounded-2xl");
    expect(tokens(false, false).some((t) => /^rounded-[bt][lr]-/.test(t))).toBe(false);
    expect(tokens(false, true)).toEqual(
      expect.arrayContaining(["rounded-bl-sm", "rounded-br-2xl"]),
    );
    expect(tokens(true, true)).toEqual(expect.arrayContaining(["rounded-br-sm", "rounded-bl-2xl"]));
  });

  it("tints the reader's own bubble with the link ink's wash over the canvas, not a tone", () => {
    const html = bubble({ own: true });
    expect(html).toContain('data-side="own"');
    expect(classTokens(html)).toContain(
      "bg-[color-mix(in_srgb,var(--ui-fg-link)_12%,var(--ui-canvas))]",
    );
    expect(classTokens(html).some((t) => t.startsWith("bg-tone-"))).toBe(false);
  });
});

describe("the channel bubble stylesheet", () => {
  const rules = read("channel-bubble.css").replace(/\/\*[\s\S]*?\*\//g, "");

  it("is loaded by the component, with the Markdown typography it adjusts", () => {
    const source = read("channel-bubble.tsx");
    expect(source).toMatch(/import "\.\/channel-bubble\.css";/);
    expect(source).toMatch(/import "\.\.\/\.\.\/content\/prose\/prose\.css";/);
  });

  it("stays unlayered, so it out-ranks the unlayered Markdown rules, and reads tokens only", () => {
    expect(rules).not.toMatch(/@layer|@apply|@reference|@import/);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|\brgb\(|\boklch\(|--color-|\.dark\b/i);
  });

  it("deepens inline code, never a fenced block's, and the table rules, one step", () => {
    expect(rules).toMatch(
      /\.channel-bubble :not\(pre\) > code \{\s*background-color: var\(--ui-line-emphasis\);/,
    );
    expect(rules).toMatch(
      /\.channel-bubble :is\(th, td\) \{\s*border-color: var\(--ui-line-emphasis\);/,
    );
  });
});
