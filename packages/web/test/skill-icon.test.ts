/** @vitest-environment jsdom */
/**
 * Plugin, Skill and hook package icons as the rows and cards draw them: an image the server
 * serves by URL, never markup in the page.
 *
 * - Given a PNG icon, when its tile is drawn, then the tile shows that image as an `<img>` and no
 *   glyph.
 * - Given a monochrome SVG icon (`tint`), when it is drawn, then it is a mask of that image
 *   filled with the text colour, and no image is shown as itself.
 * - Given an icon whose image does not load, then the kind's glyph is drawn in its place; given
 *   no icon, the glyph is drawn from the start.
 * - Given an icon whose SVG carries an `onload` script, when its tile is drawn, then the SVG is
 *   only ever a URL the page asks for: no element in the document carries the handler, and no SVG
 *   element is created from it, so there is nothing for the browser to run.
 */
import { act, createElement as h } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ICONS } from "@prismshadow/penguin-ui";
import type { IconRef } from "@prismshadow/penguin-server/api";
import { SkillIcon, SkillTile } from "../src/features/skills";
import { mount, unmountAll } from "./helpers/dom";

afterEach(unmountAll);

const PNG: IconRef = { url: "/api/plugins/photo/icon?rev=1a2b3c4d5e6f", tint: false };
const LINE: IconRef = { url: "/api/plugins/goal/icon?rev=0f1e2d3c4b5a", tint: true };

/** The mask image an element is drawn through ("" when none). */
const maskOf = (el: HTMLElement): string => String(el.style.maskImage ?? "");

/** The elements of the tile that show something: an image drawn as itself, a mask, a glyph. */
function drawn(container: HTMLElement) {
  const images = [...container.querySelectorAll("img")].filter((img) => !img.hidden);
  const masks = [...container.querySelectorAll<HTMLElement>("span")].filter((el) =>
    maskOf(el).includes("url("),
  );
  const glyph = container.querySelector(`path[d="${ICONS.puzzle}"]`);
  return { images, masks, glyph };
}

async function failToLoad(container: HTMLElement): Promise<void> {
  await act(async () => {
    for (const img of container.querySelectorAll("img")) img.dispatchEvent(new Event("error"));
  });
}

describe("an icon", () => {
  it("draws a PNG as an image at its URL, and no glyph", async () => {
    const { container } = await mount(
      h(SkillTile, { icon: PNG, name: "photo", fallback: ICONS.puzzle }),
    );
    const { images, masks, glyph } = drawn(container);
    expect(images.map((img) => img.getAttribute("src"))).toEqual([PNG.url]);
    expect(masks).toEqual([]);
    expect(glyph).toBeNull();
  });

  it("draws a monochrome SVG as a mask in the text colour, not as an image of its own", async () => {
    const { container } = await mount(
      h(SkillTile, { icon: LINE, name: "goal", fallback: ICONS.puzzle }),
    );
    const { images, masks, glyph } = drawn(container);
    expect(images).toEqual([]);
    expect(masks).toHaveLength(1);
    expect(maskOf(masks[0]!)).toContain(LINE.url);
    expect(masks[0]!.style.backgroundColor.toLowerCase()).toBe("currentcolor");
    expect(glyph).toBeNull();
  });

  it.each([
    ["a PNG", PNG],
    ["a monochrome SVG", LINE],
  ])("falls back to the kind's glyph when %s does not load", async (_label, icon) => {
    const { container } = await mount(
      h(SkillTile, { icon, name: "broken", fallback: ICONS.puzzle }),
    );
    await failToLoad(container);
    const { images, masks, glyph } = drawn(container);
    expect(images).toEqual([]);
    expect(masks).toEqual([]);
    expect(glyph).not.toBeNull();
  });

  it("draws the kind's glyph when there is no icon", async () => {
    const { container } = await mount(h(SkillIcon, { fallback: ICONS.puzzle }));
    expect(drawn(container).glyph).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("never lets a script an SVG icon carries into the page", async () => {
    const payload = '<svg xmlns="http://www.w3.org/2000/svg" onload="fetch(\'/api/me\')"/>';
    const url = `data:image/svg+xml,${encodeURIComponent(payload)}`;
    const { container } = await mount(
      h("div", null, [
        h(SkillTile, { key: "as-image", icon: { url, tint: false }, name: "evil" }),
        h(SkillTile, { key: "as-mask", icon: { url, tint: true }, name: "evil" }),
      ]),
    );
    expect(document.querySelectorAll("[onload]")).toHaveLength(0);
    // No SVG element at all: neither the payload nor a glyph, since both icons are drawn.
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("src"))).toEqual([
      url,
      url,
    ]);
  });
});
