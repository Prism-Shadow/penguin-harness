/**
 * The selected carousel's turn-taking (src/components/showcase/carousel-rotation.ts), as the pure
 * decisions the carousel makes.
 *
 * - The lead moves through the slides allowed to lead, one calendar day at a time, and wraps; it
 *   is the same all day, wherever in the day a reader opens the page.
 * - With no slide allowed to lead, or only leads that name no slide, the first slide leads.
 * - The carousel turns by itself only with more than one slide, while playing, with the pointer
 *   away and the page in view.
 * - Stepping wraps past either end.
 */
import { describe, expect, it } from "vitest";
import {
  dayNumber,
  leadIndex,
  rotates,
  stepIndex,
} from "../src/components/showcase/carousel-rotation";

const DAY = dayNumber(new Date("2026-11-17T09:30:00Z"));

describe("the slide that leads the selected carousel", () => {
  it("moves through the hero slides one day at a time, in their order, and wraps", () => {
    const heroes = [1, 3, 4];
    const week = Array.from({ length: 7 }, (_, k) => leadIndex(6, heroes, DAY + k));
    for (const lead of week) expect(heroes).toContain(lead);
    // Consecutive days take consecutive heroes, and the third day after is the first again.
    for (let k = 0; k < 6; k++) {
      const at = heroes.indexOf(week[k]!);
      expect(week[k + 1]).toBe(heroes[(at + 1) % heroes.length]);
    }
    expect(week[3]).toBe(week[0]);
  });

  it("is the same all day long, and the next one the day after", () => {
    const morning = dayNumber(new Date("2026-11-17T00:00:01Z"));
    const night = dayNumber(new Date("2026-11-17T23:59:59Z"));
    expect(night).toBe(morning);
    expect(dayNumber(new Date("2026-11-18T00:00:01Z"))).toBe(morning + 1);
    expect(leadIndex(5, [0, 2], night)).toBe(leadIndex(5, [0, 2], morning));
    expect(leadIndex(5, [0, 2], morning + 1)).not.toBe(leadIndex(5, [0, 2], morning));
  });

  it("is the first slide when no slide may lead", () => {
    for (let k = 0; k < 3; k++) expect(leadIndex(4, [], DAY + k)).toBe(0);
  });

  it("skips a lead that names no slide, and falls back to the first when none is left", () => {
    for (let k = 0; k < 3; k++) {
      expect(leadIndex(3, [7, 2, -1], DAY + k)).toBe(2);
      expect(leadIndex(3, [7, -1, 1.5], DAY + k)).toBe(0);
    }
  });
});

describe("whether the carousel turns by itself", () => {
  const free = { count: 3, playing: true, hovered: false, hidden: false };

  it("turns with several slides, playing, the pointer away and the page in view", () => {
    expect(rotates(free)).toBe(true);
  });

  it("holds still with one slide, when paused, while hovered or in a background tab", () => {
    expect(rotates({ ...free, count: 1 })).toBe(false);
    expect(rotates({ ...free, playing: false })).toBe(false);
    expect(rotates({ ...free, hovered: true })).toBe(false);
    expect(rotates({ ...free, hidden: true })).toBe(false);
  });
});

describe("stepping through the slides", () => {
  it("wraps past the last slide forward and past the first back", () => {
    expect(stepIndex(2, 3, 1)).toBe(0);
    expect(stepIndex(0, 3, -1)).toBe(2);
    expect(stepIndex(1, 3, 1)).toBe(2);
  });
});
