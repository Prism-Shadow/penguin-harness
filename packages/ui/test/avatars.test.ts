/**
 * The avatars' markup.
 *
 * - Given an Agent, its avatar draws the mascot once per theme's drawing under the avatar hook, so
 *   the theme's CSS picks one; every drawing paints in the Agent's two colours and nothing else —
 *   its pale tile and its ink — the same two in every theme; no letter is drawn and no dark-mode
 *   class is needed.
 * - Given a pinned drawing, only that drawing is drawn, outside the hook, so no theme hides it.
 * - Given two Agents in different palette slots, their penguins are inked differently.
 * - Given the pixel drawing from 16 px up, its cells land on whole CSS pixels; below 16 px it
 *   scales to the box, antialiased.
 * - An account's disc is drawn in tokens, and a stack shows a few avatars then a count, with the
 *   avatars themselves hidden from assistive technology.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "../src/components/icons/avatars/agent-avatar";
import { agentColors, agentSlot } from "../src/components/icons/avatars/agent-palette";
import { AvatarStack } from "../src/components/icons/avatars/avatar-stack";
import { USER_AVATAR_SIZE, UserAvatar } from "../src/components/icons/avatars/user-avatar";
import { renderStatic } from "../src/testing";

/** Each drawing's markup, by the `data-variant` it is written under. */
function drawings(html: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const m of html.matchAll(
    /<g data-variant="(\w+)">([\s\S]*?)(?=<g data-variant=|<\/svg>)/g,
  )) {
    found.set(m[1]!, m[2]!);
  }
  return found;
}

/** Every colour a drawing paints with. */
const fillsOf = (markup: string) =>
  new Set([...markup.matchAll(/style="fill:([^"]+)"/g)].map((m) => m[1]!));

describe("AgentAvatar", () => {
  it("draws every theme's drawing under the avatar hook, each in the Agent's own two colours", () => {
    const html = renderStatic(createElement(AgentAvatar, { id: "docs-expert" }));
    const { tile, ink } = agentColors("docs-expert");
    expect(classTokens(html)).toContain("ui-avatar");
    const drawn = drawings(html);
    expect([...drawn.keys()]).toEqual(["flat", "soft", "pixel"]);
    for (const [name, markup] of drawn) {
      expect(fillsOf(markup), `${name} paints the Agent's tile and ink alone`).toEqual(
        new Set([tile, ink]),
      );
    }
    expect(html).not.toContain("<text");
    expect(html).not.toContain("dark:");
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws a pinned drawing alone, outside the hook", () => {
    const html = renderStatic(createElement(AgentAvatar, { id: "qa", variant: "pixel" }));
    expect(classTokens(html)).not.toContain("ui-avatar");
    expect([...drawings(html).keys()]).toEqual(["pixel"]);
  });

  it("inks two Agents in different slots differently", () => {
    const [a, b] = ["agent-0", "agent-1", "agent-2", "agent-3"].filter(
      (id, i, all) => all.findIndex((other) => agentSlot(other) === agentSlot(id)) === i,
    );
    const fills = (id: string) =>
      fillsOf(drawings(renderStatic(createElement(AgentAvatar, { id }))).get("flat")!);
    expect(fills(a!)).not.toEqual(fills(b!));
  });

  it("lays the pixel penguin on whole pixels from 16px up, and scales it into a smaller box", () => {
    const pixel = (size: number) =>
      drawings(renderStatic(createElement(AgentAvatar, { id: "qa", size, variant: "pixel" }))).get(
        "pixel",
      )!;
    // 18px: one pixel a cell, centred one pixel in — 24/18 user units to a pixel.
    expect(pixel(18)).toContain('transform="translate(1.3333 1.3333) scale(1.3333)"');
    expect(pixel(18)).toContain('shape-rendering="crispEdges"');
    // 40px: two pixels a cell, the 32px drawing four pixels in.
    expect(pixel(40)).toContain('transform="translate(2.4 2.4) scale(1.2)"');
    // 14px: no whole-pixel layout fits sixteen cells; scaled and left antialiased.
    expect(pixel(14)).toContain('transform="scale(1.5)"');
    expect(pixel(14)).not.toContain("crispEdges");
  });
});

describe("UserAvatar", () => {
  it("draws the nickname's initial when no image is stored", () => {
    const html = renderStatic(
      createElement(UserAvatar, { userId: "admin", displayName: "zoe", size: 28 }),
    );
    expect(html).toContain(">Z</span>");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows a stored image cropped to the circle, with no alternative text of its own", () => {
    const html = renderStatic(
      createElement(UserAvatar, {
        userId: "admin",
        avatar: "data:image/png;base64,AAAA",
        size: USER_AVATAR_SIZE.preview,
      }),
    );
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).toContain('alt=""');
    expect(html).toContain(`width:${USER_AVATAR_SIZE.preview}px`);
  });
});

describe("AvatarStack", () => {
  const items = ["a", "b", "c", "d", "e"].map((id) => ({ id, name: id.toUpperCase() }));

  it("draws the first few and counts the rest", () => {
    const html = renderStatic(createElement(AvatarStack, { items, size: 18 }));
    expect(html.match(/<svg/g)).toHaveLength(3);
    expect(html).toContain(">+2</span>");
  });

  it("draws no count when everything fits", () => {
    const html = renderStatic(createElement(AvatarStack, { items: items.slice(0, 2), size: 18 }));
    expect(html).not.toMatch(/>\+\d/);
  });

  it("hides the avatars from assistive technology and draws an account as a disc", () => {
    const html = renderStatic(
      createElement(AvatarStack, {
        items: [
          { id: "qa", name: "QA" },
          { id: "admin", name: "Zoe", kind: "user" as const },
        ],
        size: 18,
      }),
    );
    expect(html).toMatch(/^<span class="[^"]*"><span class="[^"]*" aria-hidden="true">/);
    expect(html).toContain("border-radius:50%");
  });
});
