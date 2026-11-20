// @vitest-environment jsdom
/**
 * The selected carousel on a live page (src/components/showcase/showcase-carousel.tsx), with the
 * clock faked: a slide's stay is a timer, and the suite moves time on instead of waiting.
 *
 * - Left alone, it moves on to the next slide after a stay.
 * - While the pointer is over it, it holds; when the pointer leaves, the slide gets a full stay
 *   again before it turns.
 * - Keyboard focus coming into it stops it, and it stays stopped until Play is pressed.
 * - Under reduced motion it never starts by itself, and offers Play.
 * - Picking a thumbnail shows that slide and stops it, and the slide region then announces.
 * - Next moves to the next slide and leaves it turning.
 */
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShowcaseCarousel } from "../src/components/showcase/showcase-carousel";
import type { ShowcaseSlide } from "../src/components/showcase/showcase-carousel";
import { fire, mount, unmountAll } from "./helpers/dom";

// The reduced-motion preference is read through one media query, opened when its module loads,
// so the stand-in is in place before any import runs.
const motion = vi.hoisted(() => {
  const query = {
    matches: false,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  Object.defineProperty(window, "matchMedia", { configurable: true, value: () => query });
  return query;
});

const STAY = 7000;
const LABELS = {
  previous: "Previous",
  next: "Next",
  pause: "Pause",
  play: "Play",
  position: (index: number, count: number) => `${index} of ${count}`,
};
const TITLES = ["Goal Mode", "Browser Automation", "A2UI"];
const SLIDES: ShowcaseSlide[] = TITLES.map((title) => ({
  key: title,
  cover: createElement("span", null, `${title} cover`),
  thumb: createElement("span", null, `${title} thumbnail`),
  title,
  tagline: `${title} in one line`,
}));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
  motion.matches = false;
});

async function carousel(navigation: "thumbnails" | "controls" = "thumbnails") {
  await mount(
    createElement(ShowcaseCarousel, {
      slides: SLIDES,
      navigation,
      label: "Selected plugins",
      labels: LABELS,
      intervalMs: STAY,
    }),
  );
  return document.querySelector<HTMLElement>('[aria-roledescription="carousel"]')!;
}

/** The title of the slide on show. */
const showing = () => document.querySelector("h2")?.textContent;
const slideRegion = () => document.querySelector<HTMLElement>('[aria-roledescription="slide"]')!;
const button = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
/**
 * The thumbnail of a slide in the rail. The slide on show's cover is a button of the same name,
 * earlier on the page; the rail comes after it.
 */
const thumbnail = (title: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")]
    .filter((el) => el.getAttribute("aria-label") === title)
    .at(-1)!;

async function wait(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** The pointer entering and leaving an element, as the browser reports it. */
const pointerIn = (el: Element) =>
  fire(el, new MouseEvent("mouseover", { bubbles: true, relatedTarget: null }));
const pointerOut = (el: Element) =>
  fire(el, new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));

/** Focus arriving from the keyboard: Tab pressed, focus moving onto `el`, Tab released. */
async function tabTo(el: HTMLElement) {
  await fire(document.body, new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  await act(async () => {
    el.focus();
  });
  await fire(el, new KeyboardEvent("keyup", { key: "Tab", bubbles: true }));
}

describe("the selected carousel", () => {
  it("moves on to the next slide after a stay", async () => {
    await carousel();
    expect(showing()).toBe("Goal Mode");
    await wait(STAY - 1);
    expect(showing()).toBe("Goal Mode");
    await wait(1);
    expect(showing()).toBe("Browser Automation");
    await wait(STAY);
    expect(showing()).toBe("A2UI");
  });

  it("holds while the pointer is over it, and gives the slide a full stay once it leaves", async () => {
    const root = await carousel();
    await wait(STAY - 2000);
    await pointerIn(root);
    await wait(STAY * 3);
    expect(showing()).toBe("Goal Mode");
    await pointerOut(root);
    await wait(STAY - 1);
    expect(showing()).toBe("Goal Mode");
    await wait(1);
    expect(showing()).toBe("Browser Automation");
  });

  it("stops when keyboard focus comes in, until Play is pressed", async () => {
    await carousel();
    await tabTo(thumbnail("Browser Automation"));
    await wait(STAY * 3);
    expect(showing()).toBe("Goal Mode");
    expect(button("Play").getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      button("Play").click();
    });
    await wait(STAY);
    expect(showing()).toBe("Browser Automation");
  });

  it("never starts by itself under reduced motion, and offers Play", async () => {
    motion.matches = true;
    await carousel();
    await wait(STAY * 3);
    expect(showing()).toBe("Goal Mode");
    expect(button("Play")).not.toBeNull();
    expect(button("Pause")).toBeNull();
  });

  it("shows a picked thumbnail's slide and stops there, announcing it", async () => {
    await carousel();
    expect(slideRegion().getAttribute("aria-live")).toBe("off");
    await act(async () => {
      thumbnail("A2UI").click();
    });
    expect(showing()).toBe("A2UI");
    expect(thumbnail("A2UI").getAttribute("aria-current")).toBe("true");
    await wait(STAY * 3);
    expect(showing()).toBe("A2UI");
    expect(slideRegion().getAttribute("aria-live")).toBe("polite");
  });

  it("mounts just the current feature in controls-only navigation", async () => {
    const region = await carousel("controls");
    expect(region.querySelector(".showcase-rail")).toBeNull();
    expect(region.querySelector(".showcase-position")?.textContent).toBe("1 / 3");
    expect(region.textContent).not.toContain("Browser Automation");
    await act(async () => {
      button("Next").click();
    });
    expect(showing()).toBe("Browser Automation");
    expect(region.querySelector(".showcase-position")?.textContent).toBe("2 / 3");
    expect(region.textContent).not.toContain("Goal Mode");
  });

  it("moves on with Next and keeps turning", async () => {
    await carousel();
    await act(async () => {
      button("Next").click();
    });
    expect(showing()).toBe("Browser Automation");
    await wait(STAY);
    expect(showing()).toBe("A2UI");
    expect(button("Pause")).not.toBeNull();
  });
});
