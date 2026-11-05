/**
 * The workbench stylesheet's vocabulary: every name a published page may read stays, every
 * workbench name follows a token of the UI package's contract, and every token it reads exists.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { TOKEN_NAMES, TONES } from "@prismshadow/penguin-ui";

const css = readFileSync(new URL("../public/workbench-ui.css", import.meta.url), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/**
 * What pages could rely on before the stylesheet followed the token contract. Workbenches are
 * published and installed, so this list only ever grows: a name dropped from the stylesheet
 * breaks a page nobody here can see.
 */
const PUBLISHED_VARS = [
  "--wb-bg",
  "--wb-surface",
  "--wb-fg",
  "--wb-muted",
  "--wb-border",
  "--wb-hover",
  "--wb-accent",
  "--wb-accent-fg",
  "--wb-radius",
  "--wb-font",
  "--wb-mono",
];
const PUBLISHED_CLASSES = ["wb-muted", "wb-rows", "wb-primary", "wb-card", "wb-row"];

const TONE_PARTS = ["fg", "bg", "line"] as const;

/** `--wb-*` name → its value, from the `:root` rule that maps them. */
const rootMapping = new Map(
  css
    .slice(css.indexOf(":root {") + ":root {".length, css.indexOf("}", css.indexOf(":root {")))
    .split(";")
    .map((declaration) => declaration.trim().match(/^(--wb-[\w-]+)\s*:\s*([\s\S]*)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => [match[1]!, match[2]!.replace(/\s+/g, " ")] as const),
);

const declared = new Set([...css.matchAll(/(--wb-[\w-]+)\s*:/g)].map((m) => m[1]!));
const read = [...css.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]!);
const tokenNames = new Set<string>(TOKEN_NAMES);

describe("workbench-ui.css", () => {
  it("reads only tokens the contract defines", () => {
    const unknown = read.filter((name) => name.startsWith("--ui-") && !tokenNames.has(name));
    expect(unknown).toEqual([]);
  });

  it("keeps every published name and class", () => {
    expect(PUBLISHED_VARS.filter((name) => !rootMapping.has(name))).toEqual([]);
    const missing = PUBLISHED_CLASSES.filter(
      (name) => !new RegExp(`\\.${name}(?![\\w-])`).test(css),
    );
    expect(missing).toEqual([]);
  });

  it("maps every workbench name onto a token", () => {
    const unmapped = [...rootMapping].filter(([, value]) => !/^var\(\s*--ui-/.test(value));
    expect(unmapped).toEqual([]);
  });

  it("gives every tone its three names, each on its own token, and a badge", () => {
    for (const tone of TONES) {
      for (const part of TONE_PARTS) {
        const value = rootMapping.get(`--wb-tone-${tone}-${part}`);
        expect(value, `--wb-tone-${tone}-${part}`).toMatch(
          new RegExp(`^var\\(\\s*--ui-tone-${tone}-${part}\\s*,`),
        );
      }
      expect(css).toContain(`.wb-badge[data-tone="${tone}"]`);
    }
  });

  it("declares every workbench name it reads", () => {
    expect(read.filter((name) => name.startsWith("--wb-") && !declared.has(name))).toEqual([]);
  });
});
