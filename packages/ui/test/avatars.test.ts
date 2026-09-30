/**
 * The avatars' markup: an agent tile inks its initial through one scheme-following value (no
 * dark-mode class), an account's disc is drawn in tokens, and a stack shows a few avatars then
 * a count, with the avatars themselves hidden from assistive technology.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { AgentAvatar } from "../src/components/icons/avatars/agent-avatar";
import { avatarTile } from "../src/components/icons/avatars/avatar";
import { AvatarStack } from "../src/components/icons/avatars/avatar-stack";
import { USER_AVATAR_SIZE, UserAvatar } from "../src/components/icons/avatars/user-avatar";
import { classTokens, renderStatic } from "../src/testing";

describe("AgentAvatar", () => {
  it("draws the name's initial on the id's tile, inked with light-dark()", () => {
    const html = renderStatic(createElement(AgentAvatar, { id: "docs-expert", name: "docs" }));
    const tile = avatarTile("docs-expert");
    expect(html).toContain(`fill="${tile.bg}"`);
    expect(html).toContain(`fill:${tile.ink}`);
    expect(html).toContain(">D</text>");
    expect(html).not.toContain("dark:");
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("UserAvatar", () => {
  it("draws the nickname's initial on a token disc when no image is stored", () => {
    const html = renderStatic(
      createElement(UserAvatar, { userId: "admin", displayName: "zoe", size: 28 }),
    );
    expect(classTokens(html)).toEqual(expect.arrayContaining(["bg-fg", "text-canvas"]));
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
    expect(html).toContain("width:64px");
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
    expect(html).toMatch(/^<span class="[^"]*"><span class="flex -space-x-1" aria-hidden="true">/);
    expect(html).toContain("border-radius:50%");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["ring-canvas", "bg-fg"]));
  });
});
