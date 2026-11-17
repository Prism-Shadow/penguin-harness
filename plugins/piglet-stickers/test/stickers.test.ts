/**
 * Piggy Sticker World: the stickers and scenes a player sees.
 *
 * - Every sticker in the sticker book draws as complete SVG markup (each element closed, no
 *   number left undefined), and nothing in it points outside the drawing (no link, no address,
 *   no external url()): a sticker never loads anything.
 * - Every sticker the player can pick shows a name in Chinese and in English, and every pig a
 *   one-line description in both.
 * - The piglet draws on every body (standing, round, sitting, ghost) with every face the game
 *   has, the face a double-click gives included, with and without ears.
 * - Every scene draws in the same way and has a name in both languages.
 *
 * The drawing scripts (art.js, stickers.js, scenes.js) touch no DOM, so they run here as they
 * do in the page: one after the other, sharing their top-level names.
 */
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const ui = (name: string) =>
  readFileSync(new URL(`../workbenches/piglet-stickers/ui/${name}`, import.meta.url), "utf8");

interface Drawn {
  id: string;
  cat: string;
  svg: string;
}
interface World {
  stickers: Drawn[];
  scenes: Drawn[];
  poses: { body: string; eyes: string; ears: string; svg: string }[];
  strings: Record<"zh" | "en", Record<string, unknown>>;
}

/** Loads the page's drawing scripts and the language script, then reads what they made. */
function loadWorld(): World {
  const sandbox: Record<string, unknown> = {
    navigator: { language: "en-US" },
    localStorage: { getItem: () => null, setItem: () => {} },
    document: { documentElement: { lang: "" } },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(ui("i18n.js"), sandbox);
  const read = `
    globalThis.__world = {
      stickers: STICKERS.map((s) => ({ id: s.id, cat: s.cat, svg: stickerSVG(s) })),
      scenes: SCENES.map((s) => ({ id: s.id, cat: "scene", svg: s.svg })),
      poses: ["stand", "round", "sit", "ghost"].flatMap((body) =>
        Object.keys(FACE).flatMap((eyes) =>
          ["shown", "none"].map((ears) => ({
            body, eyes, ears,
            svg: '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
              pig({ body, eyes, ears: ears === "none" ? "none" : undefined }) + "</svg>",
          })),
        ),
      ),
    };`;
  vm.runInContext([ui("art.js"), ui("stickers.js"), ui("scenes.js"), read].join("\n;\n"), sandbox);
  const world = sandbox.__world as Omit<World, "strings">;
  const i18n = sandbox.PigletI18n as { strings: World["strings"] };
  return { ...world, strings: i18n.strings };
}

/** The problems in one piece of SVG markup: unclosed elements, holes, outside references. */
function problems(svg: string): string[] {
  const found: string[] = [];
  const open: string[] = [];
  const text = svg.replace(/<[^<>]*>/g, (tag) => {
    const close = /^<\/([a-zA-Z]+)\s*>$/.exec(tag);
    if (close) {
      if (open.pop() !== close[1]) found.push(`unexpected ${tag}`);
    } else if (!tag.endsWith("/>")) {
      const name = /^<([a-zA-Z]+)/.exec(tag);
      if (name) open.push(name[1]!);
      else found.push(`not a tag: ${tag.slice(0, 40)}`);
    }
    return "";
  });
  if (open.length) found.push(`left open: ${open.join(", ")}`);
  if (/[<>]/.test(text)) found.push("a stray angle bracket");
  if (/undefined|NaN/.test(svg)) found.push("an undefined number");
  if (/href\s*=|@import|javascript:/i.test(svg)) found.push("a link");
  if (/url\(\s*(?!['"]?#)/i.test(svg)) found.push("an external url()");
  // The SVG namespace is the only address allowed, and it is never fetched.
  if (/https?:\/\/(?!www\.w3\.org\/2000\/svg)/.test(svg)) found.push("an address");
  return found;
}

const world = loadWorld();

describe("the sticker book", () => {
  it("draws every sticker as complete markup that loads nothing", () => {
    expect(world.stickers.length).toBeGreaterThan(200);
    for (const sticker of world.stickers) {
      expect(problems(sticker.svg), sticker.id).toEqual([]);
    }
  });

  it("names every sticker in both languages, and describes every pig", () => {
    for (const sticker of world.stickers) {
      for (const lang of ["zh", "en"] as const) {
        const name = world.strings[lang][`stk.${sticker.id}`];
        expect(typeof name === "string" && name.trim().length > 0, `${lang} ${sticker.id}`).toBe(
          true,
        );
        if (sticker.cat === "pig") {
          const desc = world.strings[lang][`desc.${sticker.id}`];
          expect(typeof desc === "string" && desc.length > 0, `${lang} desc ${sticker.id}`).toBe(
            true,
          );
        }
      }
    }
    // Names are the player's way to tell stickers apart: none is shared within a language.
    for (const lang of ["zh", "en"] as const) {
      const names = world.stickers
        .filter((s) => s.cat !== "pig")
        .map((s) => world.strings[lang][`stk.${s.id}`]);
      expect(new Set(names).size, lang).toBe(names.length);
    }
  });
});

describe("the piglet", () => {
  it("draws on every body with every face, with and without ears", () => {
    // four bodies, every face, ears shown or hidden
    expect(world.poses.length).toBeGreaterThanOrEqual(4 * 11 * 2);
    for (const pose of world.poses) {
      expect(problems(pose.svg), `${pose.body}/${pose.eyes}/${pose.ears}`).toEqual([]);
    }
  });
});

describe("the scenes", () => {
  it("draws every scene as complete markup that loads nothing, named in both languages", () => {
    for (const scene of world.scenes) {
      expect(problems(scene.svg), scene.id).toEqual([]);
      for (const lang of ["zh", "en"] as const) {
        const name = world.strings[lang][`scene.${scene.id}`];
        expect(typeof name === "string" && name.length > 0, `${lang} ${scene.id}`).toBe(true);
      }
    }
  });
});
