/**
 * The helpers in src/testing — exercised on known inputs, because every guard built on them would
 * pass just as happily on a parser that had stopped seeing anything. A contrast calculator that
 * returned 21 for every pair, or a theme reader that found no declarations, would turn the
 * contract and contrast suites into green no-ops.
 */
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { TOKEN_NAMES } from "../src/tokens";
import {
  BLACK,
  GRAY_STEPS,
  WHITE,
  analyzeThemeFile,
  classTokens,
  composite,
  contractProblems,
  contrastRatio,
  darkRepeats,
  filesNamed,
  findSourceFile,
  formatColor,
  markupStructure,
  modeDeclarations,
  parseColor,
  parseCssRules,
  renderStatic,
  resolveThemeValue,
  scanSourceRoots,
  selectorList,
  unscannedRoots,
} from "../src/testing";
import { REPO_ROOT, SRC_DIR } from "./helpers/paths";

describe("parseColor", () => {
  it("reads every hex length", () => {
    expect(parseColor("#fff")).toEqual(WHITE);
    expect(parseColor("#000000")).toEqual(BLACK);
    expect(parseColor("#0f08")).toEqual({ r: 0, g: 255, b: 0, a: 0x88 / 255 });
    expect(parseColor("#2563eb80")).toEqual({ r: 0x25, g: 0x63, b: 0xeb, a: 0x80 / 255 });
    expect(parseColor("#12345")).toBeNull();
  });

  it("reads rgb() in the legacy and the modern syntax", () => {
    expect(parseColor("rgba(255, 255, 255, .1)")).toEqual({ r: 255, g: 255, b: 255, a: 0.1 });
    expect(parseColor("rgb(37 99 235 / 0.12)")).toEqual({ r: 37, g: 99, b: 235, a: 0.12 });
    expect(parseColor("rgb(0 0 0 / 45%)")).toEqual({ r: 0, g: 0, b: 0, a: 0.45 });
    expect(parseColor("rgb(100% 0% 0%)")).toEqual({ r: 255, g: 0, b: 0, a: 1 });
  });

  it("reads hsl() and oklch()", () => {
    const red = parseColor("hsl(0 100% 50%)")!;
    expect([red.r, red.g, red.b].map(Math.round)).toEqual([255, 0, 0]);
    expect(formatColor(parseColor("oklch(1 0 0)")!)).toBe("#ffffff");
    expect(formatColor(parseColor("oklch(0% 0 0)")!)).toBe("#000000");
    // Tailwind v4's stock gray-500, which the installed theme.css spells in oklch.
    const gray = parseColor("oklch(55.1% 0.027 264.364)")!;
    expect(Math.abs(gray.r - 0x6a)).toBeLessThan(1.5);
    expect(Math.abs(gray.g - 0x72)).toBeLessThan(1.5);
    expect(Math.abs(gray.b - 0x82)).toBeLessThan(1.5);
  });

  it("mixes in srgb the way color-mix() does, premultiplied", () => {
    expect(formatColor(parseColor("color-mix(in srgb, #000 50%, #fff)")!)).toBe("#808080");
    expect(parseColor("color-mix(in srgb, #ff0000 30%, transparent)")).toEqual({
      r: 255,
      g: 0,
      b: 0,
      a: 0.3,
    });
    expect(parseColor("color-mix(in oklab, red, blue)")).toBeNull();
  });

  it("refuses what it cannot read instead of guessing", () => {
    expect(parseColor("var(--ui-fg)")).toBeNull();
    expect(parseColor("currentColor")).toBeNull();
    expect(parseColor("linear-gradient(red, blue)")).toBeNull();
  });
});

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 5);
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 5);
    // #767676 is the lightest gray that clears 4.5:1 on white; #777777 is the first that fails.
    expect(contrastRatio(parseColor("#767676")!, WHITE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(parseColor("#777777")!, WHITE)).toBeLessThan(4.5);
  });

  it("composites a translucent foreground over the background first", () => {
    const halfBlack = parseColor("rgb(0 0 0 / 0.5)")!;
    expect(formatColor(composite(halfBlack, WHITE))).toBe("#808080");
    expect(contrastRatio(halfBlack, WHITE)).toBeCloseTo(3.98, 2);
  });

  it("refuses a translucent background, which has no single luminance", () => {
    expect(() => contrastRatio(BLACK, parseColor("rgb(255 255 255 / .5)")!)).toThrow(/opaque/);
  });
});

describe("parseCssRules", () => {
  const css = [
    "@layer ui-theme, ui-accent; /* a { comment } with braces */",
    "@layer ui-theme {",
    "  :root,",
    "  :root[data-theme='github'] {",
    "    --ui-canvas: #fff;",
    '    --ui-font-sans: "A;B", sans-serif;',
    "    --ui-shadow-raised: 0 1px 0 rgb(0 0 0 / 0.1)",
    "  }",
    "}",
    ":root.dark { --ui-canvas: #000; }",
  ].join("\n");
  const rules = parseCssRules(css);

  it("finds each style rule with its enclosing at-rules and its line", () => {
    expect(rules.map((r) => [r.selector, r.atRules, r.line])).toEqual([
      [":root, :root[data-theme='github']", ["@layer ui-theme"], 3],
      [":root.dark", [], 10],
    ]);
  });

  it("reads declarations through strings, parentheses and a missing final semicolon", () => {
    expect(rules[0]!.declarations).toEqual([
      { name: "--ui-canvas", value: "#fff", line: 5 },
      { name: "--ui-font-sans", value: '"A;B", sans-serif', line: 6 },
      { name: "--ui-shadow-raised", value: "0 1px 0 rgb(0 0 0 / 0.1)", line: 7 },
    ]);
  });

  it("normalizes selector lists, including attribute quoting", () => {
    expect(selectorList(rules[0]!.selector)).toEqual([":root", ':root[data-theme="github"]']);
    expect(selectorList(":root[data-theme=geek].dark, :is(a, b)")).toEqual([
      ':root[data-theme="geek"].dark',
      ":is(a, b)",
    ]);
  });
});

describe("theme file analysis", () => {
  const bridge = [
    "--color-white: #ffffff;",
    ...GRAY_STEPS.map((s) => `--color-gray-${s}: #808080;`),
  ];
  const grays = bridge.join("\n");
  const rule = (selector: string, body: string) => `${selector} {\n${body}\n}`;
  const complete = (value = "#123456") => TOKEN_NAMES.map((n) => `${n}: ${value};`).join("\n");
  /** A pack other than the base: its rules on its own root, in `ui-theme`. The base rule carries the gray bridge. */
  const geek = (light: string, dark: string, wrap = (s: string) => `@layer ui-theme {\n${s}\n}`) =>
    wrap(
      [
        rule(':root[data-theme="geek"]', `${light}\n${grays}`),
        rule(':root[data-theme="geek"].dark', dark),
      ].join("\n"),
    );

  it("accepts a complete file", () => {
    const analysis = analyzeThemeFile(geek(complete(), complete("#654321")), "geek");
    expect(analysis.declaresTokens).toBe(true);
    expect(analysis.isStub).toBe(false);
    expect(analysis.structure).toEqual([]);
    expect(contractProblems(analysis, "light")).toEqual([]);
    expect(contractProblems(analysis, "dark")).toEqual([]);
    expect(darkRepeats(analysis)).toEqual([]);
    expect(analysis.modes.light.size).toBe(TOKEN_NAMES.length + bridge.length);
    expect(analysis.modes.dark.size).toBe(TOKEN_NAMES.length);
  });

  it("completes dark from the base rule, and flags a dark value that repeats the base one", () => {
    const analysis = analyzeThemeFile(
      geek(complete(), "--ui-canvas: #000000;\n--ui-fg: #123456;\n--color-gray-50: #808080;"),
      "geek",
    );
    expect(contractProblems(analysis, "dark")).toEqual([]);
    expect(modeDeclarations(analysis, "dark").get("--ui-canvas")).toBe("#000000");
    expect(modeDeclarations(analysis, "dark").get("--ui-surface")).toBe("#123456");
    expect(darkRepeats(analysis)).toEqual(["--ui-fg: #123456", "--color-gray-50: #808080"]);
  });

  it("names a missing token, an extra one and an unknown variable per mode", () => {
    const light = complete().replace("--ui-canvas: #123456;", "--ui-bogus: #fff;");
    const analysis = analyzeThemeFile(geek(light, "--brand-thing: 1;"), "geek");
    expect(contractProblems(analysis, "light")).toEqual([
      `missing 1 of ${TOKEN_NAMES.length}: --ui-canvas`,
      "--ui-bogus is not in tokens.ts — add it to the contract or remove it",
    ]);
    // Dark mode inherits the base rule's gap and stray, and adds its own.
    expect(contractProblems(analysis, "dark")).toEqual([
      `missing 1 of ${TOKEN_NAMES.length}: --ui-canvas`,
      "--ui-bogus is not in tokens.ts — add it to the contract or remove it",
      expect.stringMatching(/^--brand-thing is neither a contract token nor a bridged/),
    ]);
  });

  it("flags a dangling token reference and an incomplete gray bridge", () => {
    const light = complete().replace("--ui-fg: #123456;", "--ui-fg: var(--ui-ink);");
    const css = geek(light, complete())
      .replace("--color-gray-500: #808080;", "")
      .replace("--color-white: #ffffff;", "");
    const analysis = analyzeThemeFile(css, "geek");
    expect(contractProblems(analysis, "light")).toEqual([
      "--ui-fg reads --ui-ink, which is not a contract token",
      "the gray bridge is incomplete — re-point --color-white, --color-gray-500",
    ]);
  });

  it("lets a pack built on the base leave names to it, and still refuses a name outside the contract", () => {
    const partial = analyzeThemeFile(
      geek("--ui-canvas: #f6f1e7;\n--ui-bogus: 1px;", "--ui-canvas: #1c1a17;"),
      "geek",
    );
    expect(contractProblems(partial, "light", { complete: false })).toEqual([
      "--ui-bogus is not in tokens.ts — add it to the contract or remove it",
    ]);
    expect(contractProblems(partial, "light")[0]).toMatch(/^missing \d+ of /);
  });

  it("flags tokens outside the canonical rules, outside the layer, and declared twice", () => {
    const wrongSelector = analyzeThemeFile(
      `@layer ui-theme { [data-theme="geek"] { --ui-canvas: #fff; } }`,
      "geek",
    );
    expect(wrongSelector.structure).toEqual([
      expect.stringContaining("declares --ui-canvas — tokens belong in the canonical rules"),
    ]);
    const unlayered = analyzeThemeFile(
      geek(complete(), complete(), (s) => s),
      "geek",
    );
    expect(unlayered.structure).toEqual([
      expect.stringContaining("the light rule sits in top level"),
      expect.stringContaining("the dark rule sits in top level"),
    ]);
    const twice = analyzeThemeFile(geek(`${complete()}\n--ui-canvas: #fff;`, complete()), "geek");
    expect(twice.structure).toEqual([
      expect.stringMatching(/--ui-canvas is declared again for light \(first at line \d+\)/),
    ]);
  });

  it("gives the base its bare-root rules in ui-base, and no pack a bare-root co-selector", () => {
    const base = analyzeThemeFile(
      `@layer ui-base {\n:root {\n${complete()}\n${grays}\n}\n:root.dark {\n${complete("#654321")}\n}\n}`,
      "modern",
    );
    expect(base.structure).toEqual([]);
    expect(contractProblems(base, "dark")).toEqual([]);
    // The base in a pack's layer would sit over every pack.
    const raised = analyzeThemeFile(
      `@layer ui-theme {\n:root {\n--ui-canvas: #fff;\n}\n}`,
      "modern",
    );
    expect(raised.structure).toEqual([
      expect.stringContaining("must sit directly in `@layer ui-base`"),
    ]);
    // Primer's old fallback co-selectors would paint a bare root in Primer's values.
    const fallback = analyzeThemeFile(
      `@layer ui-theme {\n:root, :root[data-theme="github"] {\n--ui-canvas: #fff;\n}\n}`,
      "github",
    );
    expect(fallback.structure).toEqual([
      expect.stringContaining("declares --ui-canvas — tokens belong in the canonical rules"),
    ]);
  });

  it("reads a pack's files in the layer its index serves each one in", () => {
    const sources = [
      {
        file: "tokens.css",
        css: rule(':root[data-theme="geek"]', "--ui-canvas: #fff;"),
        layer: "ui-theme",
      },
      {
        file: "accents.css",
        css: rule(':root[data-theme="geek"][data-accent="orange"]', "--ui-accent: #e32a01;"),
        layer: "ui-accent",
      },
      { file: "recipes.css", css: rule(':root[data-theme="geek"]', "--ui-fg: #000;"), layer: null },
    ];
    const analysis = analyzeThemeFile(sources, "geek");
    expect(analysis.modes.light.get("--ui-canvas")).toBe("#fff");
    expect(analysis.accents.get("orange")?.light.get("--ui-accent")).toBe("#e32a01");
    // A file served in no layer is named by its path in the problem.
    expect(analysis.structure).toEqual([
      expect.stringMatching(/^recipes\.css line 1: the light rule sits in top level/),
    ]);
  });

  it("tells a stub from a file whose tokens were deleted", () => {
    expect(analyzeThemeFile("/** Stub: filled later. */", "geek").isStub).toBe(true);
    expect(analyzeThemeFile("/** Console. */\n@layer ui-theme {}", "geek").isStub).toBe(false);
  });

  it("resolves var() through the cascade the layers produce", () => {
    const base = analyzeThemeFile(
      `@layer ui-base {
        :root { --color-gray-900: #101828; --ui-fg: var(--color-gray-900); --ui-line: var(--ui-missing, #d1d5dc); --ui-canvas: #fafafa; }
        :root.dark { --color-gray-900: #0d0d0d; --ui-canvas: #1b1c1e; }
      }`,
      "modern",
    );
    const pack = analyzeThemeFile(
      `@layer ui-theme { :root[data-theme="geek"] { --ui-surface: var(--color-gray-900); --ui-canvas: #fbfafa; } }`,
      "geek",
    );
    // A dark value the base leaves alone falls back to its own light rule's declaration…
    expect(resolveThemeValue("--ui-fg", "dark", base, base)).toBe("#0d0d0d");
    // …with fallbacks honoured, and the base's rules reachable from any pack.
    expect(resolveThemeValue("--ui-line", "light", base, base)).toBe("#d1d5dc");
    expect(resolveThemeValue("--ui-surface", "light", pack, base)).toBe("#101828");
    // A pack's light value outranks the base's dark one: the pack's layer is above the base's.
    expect(resolveThemeValue("--ui-canvas", "dark", pack, base)).toBe("#fbfafa");
    expect(resolveThemeValue("--ui-shadow-flat", "light", pack, base)).toBeNull();
    const cycle = analyzeThemeFile(
      `@layer ui-base { :root { --ui-fg: var(--ui-fg-muted); --ui-fg-muted: var(--ui-fg); } }`,
      "modern",
    );
    expect(resolveThemeValue("--ui-fg", "light", cycle, cycle)).toBeNull();
  });
});

describe("scanSourceRoots", () => {
  const scan = scanSourceRoots(
    { ui: SRC_DIR, gone: join(SRC_DIR, "no-such-directory") },
    { repoRoot: REPO_ROOT },
  );

  it("reads a real root with repo-relative, forward-slash ids", () => {
    const tokens = findSourceFile(scan, "packages/ui/src/tokens.ts");
    expect(tokens).toBeDefined();
    expect(tokens!.root).toBe("ui");
    expect(tokens!.rel).toBe("tokens.ts");
    expect(tokens!.text).toContain("export const TOKEN_NAMES");
    expect(scan.files.every((file) => !file.id.includes("\\"))).toBe(true);
    expect(filesNamed(scan, "tokens.ts").map((file) => file.id)).toEqual([
      "packages/ui/src/tokens.ts",
    ]);
  });

  it("reports a root that yielded nothing instead of passing over it", () => {
    expect(scan.roots.find((root) => root.name === "ui")!.files).toBeGreaterThan(0);
    expect(unscannedRoots(scan)).toEqual([
      `gone (${join(SRC_DIR, "no-such-directory")}): directory does not exist`,
    ]);
  });
});

describe("static render helpers", () => {
  it("renders markup and separates structure from styling", () => {
    const html = renderStatic(
      createElement("button", { className: "px-2 rounded-md", style: { color: "red" } }, "Go"),
    );
    expect(html).toBe('<button class="px-2 rounded-md" style="color:red">Go</button>');
    expect(markupStructure(html)).toBe("<button>Go</button>");
    expect(classTokens(html)).toEqual(["px-2", "rounded-md"]);
  });
});
