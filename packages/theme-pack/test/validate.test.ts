/**
 * The validator, as an import meets it.
 *
 * - Given a Doodle-shaped pack, it is accepted; what is kept is the re-emitted text, and checking
 *   what was kept again gives the same bytes and the same version (re-emission is stable).
 * - Given an accepted pack, the served stylesheet carries the tokens, recipes and section skins in
 *   `ui-theme`, the accent presets in `ui-accent` and the faces outside any layer; every url()
 *   naming a pack file points at the pack's files route at its version, and inline images stay.
 * - Given a build's sheets, one with a comment naming a layer and a later one naming layers again,
 *   a pack is served behind the statement and at the address their real layers give, in the order
 *   first named (that the statement keeps the app's order and the address moves with a new build's
 *   order runs in the server's suite, over real imports).
 * - Given the same pack with one value changed, it is served at another version.
 * - Given a pack breaking one rule, it is refused whole, naming the file, the line and why — one
 *   scenario per reason: a remote url(), @import, a prefix test of an input's value, !important, a
 *   rule outside the pack's root, @layer, an unknown custom property, an oversized data: image, a
 *   .ttf font, a .woff2 that is not WOFF2, an SVG with a script, text the parser cannot read, an
 *   unknown function, an unknown at-rule, the site chrome, an id selector, keyframes named outside
 *   the pack's own names.
 * - Given a pack written against a newer theme API, it is refused as unsupported.
 * - Given a preset pack.json lists and accents.css never declares, the pack is refused.
 * - Given the build's clean-baseline rules, they read the stylesheets as re-emitted, in their
 *   layers, the faces left out, and their first hit refuses the pack, naming the rule, what it says
 *   and what it found (the rules themselves run in the server's suite, over real imports).
 * - Given stylesheets adding up past 512 KiB, the pack is refused as too large.
 */
import { describe, expect, it } from "vitest";
import {
  ThemePackError,
  layerOrder,
  layerStatement,
  servedVersion,
  validateThemePack,
} from "../src/index.js";
import {
  APP_LAYERS,
  APP_SHEET,
  CONTRACT,
  DOODLE_MANIFEST,
  DOODLE_RECIPES,
  DOODLE_TOKENS,
  doodlePack,
} from "./fixtures.js";

const decode = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes);

/** The refusal `validateThemePack` throws for these files. */
async function refusal(files: Map<string, Uint8Array>): Promise<ThemePackError> {
  try {
    await validateThemePack(files, CONTRACT);
  } catch (err) {
    if (err instanceof ThemePackError) return err;
    throw err;
  }
  throw new Error("the pack was accepted");
}

/** A recipes.css holding the Doodle recipes and one more rule. */
const recipesWith = (rule: string) => ({ "recipes.css": `${DOODLE_RECIPES}${rule}\n` });
const RECIPES_LINES = DOODLE_RECIPES.split("\n").length;

describe("validateThemePack", () => {
  it("accepts a Doodle-shaped pack and keeps it re-emitted, stable under a second check", async () => {
    const first = await validateThemePack(doodlePack(), CONTRACT);
    expect(first.manifest.id).toBe("sketch");
    expect(decode(first.files.get("tokens.css"))).not.toContain("/* Paper");
    const again = await validateThemePack(first.files, CONTRACT);
    expect([...again.files.keys()].sort()).toEqual([...first.files.keys()].sort());
    for (const [path, bytes] of first.files)
      expect(decode(again.files.get(path)), path).toBe(decode(bytes));
    expect(again.v).toBe(first.v);
    expect(again.indexCss).toBe(first.indexCss);
  });

  it("serves the stylesheets in their layers, with pack urls on the files route at the version", async () => {
    const pack = await validateThemePack(doodlePack(), CONTRACT);
    const css = pack.indexCss;
    expect(pack.v).toMatch(/^[0-9a-f]{8}$/);
    // The faces first, outside any layer; the build's layer order is the server's to put in front.
    expect(css.startsWith("@font-face{")).toBe(true);
    expect(css).toContain(`url(/api/themes/sketch/files/fonts/hand.woff2?v=${pack.v})`);
    expect(css).toContain(`url(/api/themes/sketch/files/art/empty.svg?v=${pack.v})`);
    expect(css).toContain("url(data:image/png;base64,");
    const theme = css.indexOf("@layer ui-theme{");
    const accent = css.indexOf("@layer ui-accent{");
    expect(theme).toBeGreaterThan(0);
    expect(accent).toBeGreaterThan(theme);
    expect(css.slice(theme, accent)).toContain('.ui-empty [data-slot="art"]');
    expect(css.slice(accent)).toContain('[data-accent="marker"]');
    // What is kept names the pack's files as the pack does, not where the server serves them.
    expect(decode(pack.files.get("fonts.css"))).toContain("url(fonts/hand.woff2)");
    expect(pack.served).toEqual(["index.css", "art/empty.svg", "fonts/hand.woff2"]);
  });

  it("serves a pack behind the layers a build's sheets name first, a layer named in a comment left out", () => {
    // The compiled app sheet's banner comment names a layer, and a later sheet the page links
    // names two of its layers again: neither moves what a pack is served with, the statement in
    // front of it and its address.
    const sheets = `${APP_SHEET}\n@layer ui-theme{}@layer base{}`;
    const servedWith = (layers: readonly string[]) => ({
      statement: layerStatement(layers),
      v: servedVersion("5e1f0c2a", layers),
    });
    expect(servedWith(layerOrder(sheets))).toEqual(servedWith(APP_LAYERS));
  });

  it("serves a pack with one value changed at another version", async () => {
    const before = await validateThemePack(doodlePack(), CONTRACT);
    const after = await validateThemePack(
      doodlePack({ "tokens.css": DOODLE_TOKENS.replace("#f6f1e7", "#f6f1e8") }),
      CONTRACT,
    );
    expect(after.v).not.toBe(before.v);
  });

  const scoped = (body: string) => `:root[data-theme="sketch"] ${body}`;
  it.each([
    [
      "a remote url()",
      scoped(".ui-edge { background: url(https://example.invalid/x.png); }"),
      "nothing on the network",
    ],
    [
      "a remote url() in a var() fallback",
      scoped(".ui-edge { background: var(--_bg, url(https://example.invalid/x.png)); }"),
      "nothing on the network",
    ],
    ["@import", '@import "other.css";', "@import is refused"],
    [
      "a prefix test of a value",
      scoped('input[value^="sk-"] { color: red; }'),
      "[value] is refused",
    ],
    ["!important", scoped(".ui-edge { color: red !important; }"), "!important is refused"],
    [
      "a rule outside the pack's root",
      ".ui-edge { color: red; }",
      'starts with :root[data-theme="sketch"]',
    ],
    ["@layer", "@layer ui-theme { .ui-edge { color: red; } }", "@layer is refused"],
    [
      "an unknown custom property",
      scoped(".ui-edge { --leak: 1px; }"),
      "--leak is not a theme token",
    ],
    [
      "an oversized data: image",
      scoped(`.ui-edge { background: url("data:image/png;base64,${"A".repeat(33 * 1024)}"); }`),
      "is over 32 KiB",
    ],
    ["text the parser cannot read", scoped(".ui-edge[data-x { color: red; }"), "does not parse"],
    [
      "an unknown function",
      scoped(".ui-edge { width: attr(data-width px); }"),
      "attr() is not allowed",
    ],
    ["an unknown at-rule", "@scope (.ui-edge) { .x { color: red; } }", "@scope is not allowed"],
    ["the site chrome", scoped(".site\\2d ui { color: red; }"), "(.site-ui)"],
    ["an id selector", scoped("#composer { color: red; }"), "id selector"],
    [
      "keyframes under another name",
      "@keyframes spin { to { opacity: 0; } }",
      "@keyframes names start with sketch- or ui-",
    ],
  ])("refuses %s in a stylesheet, naming where", async (_name, rule, reason) => {
    const err = await refusal(doodlePack(recipesWith(rule)));
    expect(err.kind).toBe("invalid");
    expect(err.problem.file).toBe("recipes.css");
    expect(err.problem.reason).toContain(reason);
    expect(err.problem.line).toBe(RECIPES_LINES);
  });

  it.each([
    [
      "a .ttf font",
      { "fonts/hand.ttf": new Uint8Array([0, 1, 0, 0]) },
      "fonts/hand.ttf",
      "is not a file a pack may hold",
    ],
    [
      "a .woff2 that is not WOFF2",
      { "fonts/hand.woff2": new Uint8Array([0, 1, 0, 0, ...new Array(60).fill(0)]) },
      "fonts/hand.woff2",
      "is not a WOFF2 font",
    ],
    [
      "an SVG with a script",
      {
        "art/empty.svg":
          '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/me")</script></svg>',
      },
      "art/empty.svg",
      "is not a plain SVG",
    ],
  ])("refuses %s, naming the file", async (_name, overrides, file, reason) => {
    const err = await refusal(doodlePack(overrides));
    expect(err.kind).toBe("invalid");
    expect(err.problem.file).toBe(file);
    expect(err.problem.reason).toContain(reason);
  });

  it("refuses a pack written against a newer theme API as unsupported", async () => {
    const err = await refusal(
      doodlePack({ "pack.json": JSON.stringify({ ...DOODLE_MANIFEST, api: 2 }) }),
    );
    expect(err.kind).toBe("api_unsupported");
    expect(err.problem.file).toBe("pack.json");
  });

  it("refuses a preset pack.json lists that accents.css does not declare", async () => {
    const manifest = {
      ...DOODLE_MANIFEST,
      accent: {
        ...DOODLE_MANIFEST.accent,
        presets: [...DOODLE_MANIFEST.accent.presets, { id: "chalk", swatch: "#fff" }],
      },
    };
    const err = await refusal(doodlePack({ "pack.json": JSON.stringify(manifest) }));
    expect(err.problem.file).toBe("accents.css");
    expect(err.problem.reason).toContain("chalk");
  });

  it("hands the build's clean-baseline rules what the browser will receive, and refuses on their first hit", async () => {
    const seen: { file: string; css: string; layer: string | null }[] = [];
    const rules = {
      hits: (sources: readonly { file: string; css: string; layer: string | null }[]) => {
        seen.push(...sources);
        return [{ rule: "R7", file: "recipes.css", line: 1, found: ".ui-edge { padding: 4px }" }];
      },
      says: { R7: "the type and spacing scale moves only through tokens" },
    };
    const refused = await validateThemePack(doodlePack(), { ...CONTRACT, cleanliness: rules }).then(
      () => null,
      (e: unknown) => e as ThemePackError,
    );
    expect(refused?.problem).toEqual({
      file: "recipes.css",
      reason: "R7, the type and spacing scale moves only through tokens: .ui-edge { padding: 4px }",
    });
    const accepted = await validateThemePack(doodlePack(), CONTRACT);
    expect(seen.map(({ file, layer }) => [file, layer])).toEqual([
      ["tokens.css", "ui-theme"],
      ["recipes.css", "ui-theme"],
      ["sections/empty.css", "ui-theme"],
      ["accents.css", "ui-accent"],
    ]);
    for (const { file, css } of seen) expect(css, file).toBe(decode(accepted.files.get(file)));
  });

  it("refuses stylesheets adding up past 512 KiB as too large", async () => {
    const padding = scoped(`.ui-edge { --_pad: ${"x".repeat(1024)}; }\n`).repeat(520);
    const err = await refusal(doodlePack({ "recipes.css": padding }));
    expect(err.kind).toBe("too_large");
  });
});
