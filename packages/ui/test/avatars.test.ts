/**
 * The avatars' markup.
 *
 * - Given an Agent, its avatar draws the mascot once per theme's drawing under the avatar hook, so
 *   the theme's CSS picks one; every drawing paints in the Agent's own palette colours and nothing
 *   else, the same colours and the same smiling face in every theme; no letter is drawn and no
 *   dark-mode class is needed.
 * - Given the same Agent twice, its avatar is drawn the same both times.
 * - Given a pinned drawing, only that drawing is drawn, outside the hook, so no theme hides it.
 * - Given two Agents in different palette slots, their penguins are painted differently.
 * - Given a small avatar, the face drops the cheeks it cannot resolve; from 20 px up they show.
 * - Given the pixel drawing from 16 px up, its cells land on whole CSS pixels; below 16 px it
 *   scales to the box, antialiased.
 * - Given a picture of the Agent's own, it is drawn instead of the mascot, in the Agent's
 *   rounded tile rather than a circle, under the same hook; a stack draws an Agent's picture too.
 * - An account's disc is drawn in tokens, and a stack shows a few avatars then a count, with the
 *   avatars themselves hidden from assistive technology.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "../src/components/icons/avatars/agent-avatar";
import { AGENT_AVATAR_VARIANT_NAMES } from "../src/components/icons/avatars/agent-avatar-variants";
import { agentColors, agentSlot } from "../src/components/icons/avatars/agent-palette";
import { AvatarStack } from "../src/components/icons/avatars/avatar-stack";
import { USER_AVATAR_SIZE, UserAvatar } from "../src/components/icons/avatars/user-avatar";
import { classTokens, renderStatic } from "../src/testing";

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

/** Every colour a drawing paints with, filled or stroked. */
const paintsOf = (markup: string) =>
  new Set([...markup.matchAll(/style="(?:fill|stroke):([^"]+)"/g)].map((m) => m[1]!));

const avatar = (props: Parameters<typeof AgentAvatar>[0]) =>
  renderStatic(createElement(AgentAvatar, props));

describe("AgentAvatar", () => {
  it("draws every theme's drawing under the avatar hook, in the Agent's colours", () => {
    const html = avatar({ id: "docs-expert", size: 48 });
    const { tile, coat, face, mark, blush } = agentColors("docs-expert");
    expect(classTokens(html)).toContain("ui-avatar");
    const drawn = drawings(html);
    expect([...drawn.keys()]).toEqual(AGENT_AVATAR_VARIANT_NAMES);
    for (const [name, markup] of drawn) {
      expect(paintsOf(markup), `${name} paints the Agent's colours alone`).toEqual(
        new Set([tile, coat, face, mark, blush]),
      );
    }
    expect(html).not.toContain("<text");
    expect(html).not.toContain("dark:");
    expect(html).toContain('aria-hidden="true"');
  });

  it("draws the same Agent the same way every time", () => {
    for (const id of ["qa", "release-notes", "agent-7", "深度求索"]) {
      expect(avatar({ id, size: 24 })).toBe(avatar({ id, size: 24 }));
    }
  });

  it("draws a pinned drawing alone, outside the hook", () => {
    const html = avatar({ id: "qa", variant: "pixel" });
    expect(classTokens(html)).not.toContain("ui-avatar");
    expect([...drawings(html).keys()]).toEqual(["pixel"]);
  });

  it("paints two Agents in different slots differently", () => {
    const [a, b] = ["agent-0", "agent-1", "agent-2", "agent-3"].filter(
      (id, i, all) => all.findIndex((other) => agentSlot(other) === agentSlot(id)) === i,
    );
    const paints = (id: string) => paintsOf(drawings(avatar({ id })).get("flat")!);
    expect(paints(a!)).not.toEqual(paints(b!));
  });

  it("leaves the cheeks off below 20px and draws them from 20px up", () => {
    const { blush } = agentColors("qa");
    for (const variant of AGENT_AVATAR_VARIANT_NAMES) {
      const at = (size: number) =>
        paintsOf(drawings(avatar({ id: "qa", size, variant })).get(variant)!);
      expect(at(16), `${variant} at 16px`).not.toContain(blush);
      expect(at(24), `${variant} at 24px`).toContain(blush);
    }
  });

  it("draws the Agent's own picture in its rounded tile, under the hook, instead of the mascot", () => {
    const html = renderStatic(
      createElement(AgentAvatar, { id: "qa", size: 48, src: "/pictures/qa.png" }),
    );
    expect(html).toMatch(/^<img /);
    expect(html).toContain('src="/pictures/qa.png"');
    expect(html).toContain('alt=""');
    expect(classTokens(html)).toContain("ui-avatar");
    // A rounded tile, not an account's circle: its corner is above zero and short of half its side.
    const radius = Number(/border-radius:([\d.]+)px/.exec(html)![1]);
    expect(radius).toBeGreaterThan(0);
    expect(radius).toBeLessThan(24);
    expect(drawings(html).size).toBe(0);
  });

  /** The pixel drawing's placement at `size` px: its transform, and whether its edges are crisp. */
  const pixelAt = (size: number) => {
    const markup = drawings(avatar({ id: "qa", size, variant: "pixel" })).get("pixel")!;
    const transform = /<g transform="([^"]+)"/.exec(markup)![1]!;
    return { transform, crisp: markup.includes('shape-rendering="crispEdges"') };
  };

  it.each(Array.from({ length: 33 }, (_, n) => n + 16))(
    "lays the pixel penguin's cells on whole CSS pixels at %ipx",
    (size) => {
      const { transform, crisp } = pixelAt(size);
      const m = /^translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)$/.exec(transform)!;
      const [x, y, scale] = [Number(m[1]), Number(m[2]), Number(m[3])];
      // A unit of the 24-unit box is size/24 CSS pixels: a cell and the offset are whole pixels, to
      // the transform's rounding.
      const cellPx = (scale * size) / 24;
      expect(Math.round(cellPx)).toBeGreaterThanOrEqual(1);
      expect(cellPx).toBeCloseTo(Math.round(cellPx), 2);
      expect(x).toBe(y);
      expect((x * size) / 24).toBeCloseTo(Math.round((x * size) / 24), 2);
      expect(crisp).toBe(true);
    },
  );

  it("scales the pixel penguin into a box too small for whole-pixel cells, antialiased", () => {
    const { transform, crisp } = pixelAt(14);
    const scale = Number(/^scale\(([\d.]+)\)$/.exec(transform)![1]);
    // Sixteen cells fill the 24-unit box.
    expect(16 * scale).toBe(24);
    expect(crisp).toBe(false);
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

  it("draws an Agent's own picture among the tiles", () => {
    const html = renderStatic(
      createElement(AvatarStack, {
        items: [{ id: "qa", name: "QA", src: "/pictures/qa.png" }, ...items.slice(0, 2)],
        size: 24,
      }),
    );
    expect(html).toContain('src="/pictures/qa.png"');
    expect(html.match(/<svg/g)).toHaveLength(2);
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
