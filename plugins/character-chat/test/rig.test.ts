/**
 * The portraits and the scenes, as the page draws them.
 *
 * - Given any kind and any mood, then a portrait of that kind with that face is drawn, and every
 *   face that blinks has its eyes drawn shut as well as open, and every mouth a talking shape.
 * - Given a look whose values are not a colour or a short word, then none of them reaches the
 *   markup and the kind's own colours are drawn instead.
 * - Given a card's words with markup in them, then the portrait carries none of it.
 * - Given any scene and any light, then that scene is drawn in that light; an unknown scene is
 *   the plain one.
 */
import { describe, expect, it } from "vitest";
// @ts-expect-error a plain-JS page module
import { KINDS, MOODS, PARTS, portrait } from "../workbenches/characters/ui/rig.js";
// @ts-expect-error a plain-JS page module
import { SCENES, scene } from "../workbenches/characters/ui/scenes.js";

const kinds = KINDS as string[];
const moods = MOODS as string[];
const parts = PARTS as Record<string, Record<string, string[]>>;
const draw = portrait as (meta: unknown, mood: string, opts?: { face?: boolean }) => string;

/** Faces drawn with the eyes already shut, or half shut, do not blink. */
const still = (kind: string, mood: string) =>
  mood === "laugh" ||
  mood === "sleepy" ||
  (mood === "pout" && (kind === "robot" || kind === "human"));

describe("a portrait", () => {
  for (const kind of kinds) {
    it(`draws a ${kind} in every mood, blinking and talking`, () => {
      for (const mood of moods) {
        const svg = draw({ kind, look: {} }, mood);
        expect(svg).toContain(`data-kind="${kind}"`);
        expect(svg).toContain(`data-mood="${mood}"`);
        expect(svg).toContain('class="rig-mouth-talk"');
        if (!still(kind, mood)) expect(svg, `${kind} ${mood}`).toContain('class="rig-shut"');
      }
    });
  }

  it("draws every part a kind can wear", () => {
    for (const kind of kinds)
      for (const [part, options] of Object.entries(parts[kind] ?? {}))
        for (const option of options.slice(1)) {
          const first = draw({ kind, look: { [part]: options[0] } }, "neutral");
          const worn = draw({ kind, look: { [part]: option } }, "neutral");
          expect(worn, `${kind} ${part}=${option}`).not.toBe(first);
        }
  });

  it("never puts a look value that is not a colour or a word into the markup", () => {
    const hostile = {
      hair: '#123456"/><script>alert(1)</script>',
      top: "url(https://example.invalid/x.png)",
      skin: "red; fill: blue",
      accessory: '"><image href="x"/>',
      hairstyle: "TWINTAILS",
    };
    const svg = draw({ kind: "human", look: hostile }, "happy");
    for (const value of Object.values(hostile)) expect(svg).not.toContain(value);
    expect(svg).not.toMatch(/<script|<image|url\(/i);
    expect(svg).toBe(draw({ kind: "human", look: {} }, "happy"));
  });

  it("carries none of a card's words, whatever they hold", () => {
    const svg = draw(
      { kind: "cat", name: "<b>Mochi</b>", tagline: "<img src=x onerror=alert(1)>", look: {} },
      "wink",
    );
    expect(svg).not.toContain("Mochi");
    expect(svg).not.toContain("onerror");
  });

  it("crops to the head for a roster row", () => {
    for (const kind of kinds)
      expect(draw({ kind, look: {} }, "neutral", { face: true })).not.toContain(
        'viewBox="0 0 400 440"',
      );
  });
});

describe("a scene", () => {
  it("is drawn in each light of the day, and an unknown one is the plain studio", () => {
    for (const name of SCENES as string[])
      for (const phase of ["day", "dusk", "night"]) {
        const svg = (scene as (n: string, p: string) => string)(name, phase);
        expect(svg).toContain(`data-scene="${name}"`);
        expect(svg).toContain(`data-phase="${phase}"`);
      }
    expect((scene as (n: string, p: string) => string)("castle", "night")).toContain(
      'data-scene="plain"',
    );
  });
});
