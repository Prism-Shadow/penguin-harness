// @vitest-environment jsdom
/**
 * A cover on a live page (src/components/showcase/cover.tsx): which picture a subject wears, and
 * what the box shows while an authored one is on its way. jsdom fetches no image, so the suite
 * plays the browser's `load` and `error` events on the picture itself.
 *
 * - Without an authored image, the generated cover is drawn: the subject's icon on the tile and
 *   the product's logo in the corner.
 * - Without an icon either, the logo takes the tile, and no corner mark repeats it.
 * - An authored image that fails to load gives way to the generated cover.
 * - While an authored image is on its way, the box holds the picture's tone and no generated
 *   drawing; once it loads, the picture shows.
 * - A card's cover asks for the thumbnail and a hero's for the full picture.
 */
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Cover } from "../src/components/showcase/cover";
import type { CoverProps } from "../src/components/showcase/cover";
import { fire, mount, unmountAll } from "./helpers/dom";

const ICON = { url: "https://example.test/plugins/goal/icon.png", tint: false };
const LOGO = "https://example.test/logo.svg";
const PICTURE = {
  src: "https://example.test/market/goal/cover.webp",
  thumb: "https://example.test/market/goal/cover-640.webp",
  tone: "#3d7a55",
};

afterEach(unmountAll);

async function cover(props: Omit<CoverProps, "seed">) {
  const { container } = await mount(createElement(Cover, { seed: "goal", ...props }));
  return container.querySelector<HTMLElement>('[data-part="cover"]')!;
}

const images = (root: Element) => [...root.querySelectorAll("img")].map((img) => img.src);
const tile = (root: Element) => root.querySelector('[data-part="tile"]');
const drawing = (root: Element) => root.querySelector('[data-part="art"]');
/** The authored picture: the cover's own image, never one inside the generated drawing. */
const picture = (root: Element) => root.querySelector<HTMLImageElement>(":scope > img");

describe("a cover without an authored image", () => {
  it("is the generated cover: the subject's icon on the tile, the product's logo in the corner", async () => {
    const root = await cover({ icon: ICON, logo: LOGO });
    expect(drawing(root)).not.toBeNull();
    expect(images(tile(root)!)).toEqual([ICON.url]);
    expect(images(root)).toEqual([ICON.url, LOGO]);
  });

  it("puts the product's logo on the tile when the subject has no icon, and nowhere else", async () => {
    const root = await cover({ logo: LOGO });
    expect(images(tile(root)!)).toEqual([LOGO]);
    expect(images(root)).toEqual([LOGO]);
  });
});

describe("a cover with an authored image", () => {
  it("shows the picture's tone and no generated drawing while the picture is on its way", async () => {
    const root = await cover({ image: PICTURE, icon: ICON, logo: LOGO });
    expect(drawing(root)).toBeNull();
    expect(images(root)).toEqual([PICTURE.thumb]);
    expect(root.style.getPropertyValue("--showcase-cover-tone")).toBe(PICTURE.tone);
    expect(root.dataset.state).toBe("loading");

    await fire(picture(root)!, new Event("load"));
    expect(root.dataset.state).toBe("loaded");
    expect(drawing(root)).toBeNull();
  });

  it("gives way to the generated cover when the picture does not load", async () => {
    const root = await cover({ image: PICTURE, icon: ICON, logo: LOGO });
    await fire(picture(root)!, new Event("error"));
    expect(picture(root)).toBeNull();
    expect(drawing(root)).not.toBeNull();
    expect(images(tile(root)!)).toEqual([ICON.url]);
    // The field is the hue's again, not the tone of a picture that never came.
    expect(root.style.getPropertyValue("--showcase-cover-tone")).toBe("");
  });

  it("asks for the thumbnail on a card and the full picture on a hero", async () => {
    expect(images(await cover({ image: PICTURE }))).toEqual([PICTURE.thumb]);
    expect(images(await cover({ image: PICTURE, rendition: "full" }))).toEqual([PICTURE.src]);
    // Without a thumbnail, a card draws the full picture.
    expect(images(await cover({ image: { src: PICTURE.src } }))).toEqual([PICTURE.src]);
  });
});
