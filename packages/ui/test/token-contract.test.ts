/**
 * The token contract (src/tokens.ts): every theme × mode defines every name — the base rule plus
 * that mode's own, the dark rule declaring only what dark changes — and nothing else is a token.
 *
 * Components read tokens by name and never ask which theme is active, so a name one theme leaves
 * out does not fail loudly anywhere — the property is simply unset, the utility that reads it
 * computes to its initial value, and a surface turns transparent or a label falls back to the
 * browser's serif in that one theme and mode only. The theme files are parsed here and diffed
 * against the contract so that gap is a named test failure instead of a screenshot someone has to
 * notice.
 *
 * A theme file that does not exist yet, or is still the skeleton's stub (its header says `Stub:`
 * and it declares no `--ui-*` property), is reported as a skipped, named case — never as a pass.
 * The moment a file declares a single token, the whole contract applies to it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_ID, THEME_IDS, THEME_MODES, TOKEN_GROUPS, TOKEN_NAMES } from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import {
  analyzeFile,
  analyzeThemeFile,
  contractProblems,
  darkRepeats,
  matchesPolicyPath,
  scanSourceRoots,
  stripCssComments,
  unscannedRoots,
} from "../src/testing";
import type { SourceFile, ThemeFileAnalysis } from "../src/testing";
import { REPO_ROOT, SRC_DIR, WEB_DIR } from "./helpers/paths";

type ThemeState =
  | { id: ThemeId; file: string; status: "filled"; analysis: ThemeFileAnalysis }
  | { id: ThemeId; file: string; status: "pending"; reason: string };

function themeState(id: ThemeId): ThemeState {
  const file = `src/themes/${id}.css`;
  const path = join(SRC_DIR, "themes", `${id}.css`);
  if (!existsSync(path)) {
    return { id, file, status: "pending", reason: "the file does not exist yet" };
  }
  const analysis = analyzeThemeFile(readFileSync(path, "utf8"), id);
  if (analysis.isStub) {
    return {
      id,
      file,
      status: "pending",
      reason: "still the skeleton's stub (no --ui-* declared)",
    };
  }
  return { id, file, status: "filled", analysis };
}

const THEMES = THEME_IDS.map(themeState);

describe("the contract itself", () => {
  it("lists each name once, every one a --ui-* custom property", () => {
    expect(TOKEN_NAMES.length).toBeGreaterThan(0);
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
    expect(TOKEN_NAMES.filter((name) => !/^--ui-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name))).toEqual([]);
  });

  it("flattens its groups in order, with no empty group", () => {
    expect(TOKEN_GROUPS.flatMap((group) => group.names)).toEqual(TOKEN_NAMES);
    expect(TOKEN_GROUPS.map((group) => group.names.length).filter((n: number) => n === 0)).toEqual(
      [],
    );
    expect(new Set(TOKEN_GROUPS.map((group) => group.id)).size).toBe(TOKEN_GROUPS.length);
  });
});

describe("theme files", () => {
  it("exist for the default theme, which every other theme's cascade falls back on", () => {
    // Skipping a stub is for themes still being written; the default file's absence would leave
    // every <html> with no tokens at all.
    expect(existsSync(join(SRC_DIR, "themes", `${DEFAULT_THEME_ID}.css`))).toBe(true);
  });

  for (const theme of THEMES) {
    if (theme.status === "pending") {
      it.skip(`${theme.file} — PENDING, contract not checked: ${theme.reason}`, () => {});
      continue;
    }
    const { analysis } = theme;

    describe(theme.file, () => {
      it("declares its tokens in the two canonical rules, inside @layer ui-theme, once each", () => {
        expect(analysis.structure).toEqual([]);
      });

      for (const mode of THEME_MODES) {
        const rules = mode === "light" ? "the base rule" : "the base rule plus the dark rule";
        it(`defines every contract name in ${mode} mode (${rules}), and nothing outside the contract`, () => {
          expect(
            contractProblems(analysis, mode),
            `${theme.file} (${mode}: ${rules}) must declare exactly the names in tokens.ts`,
          ).toEqual([]);
        });
      }

      it("declares in its dark rule only what dark changes", () => {
        // `:root.dark` also matches the base rule, so a dark declaration equal to the base one is a
        // second copy of that value: the mode-independent groups (shape, type, density, motion,
        // icons) live once, in the base rule (user decision, 2026-09-18).
        expect(
          darkRepeats(analysis),
          `${theme.file}: the dark rule repeats these base values — drop them from it`,
        ).toEqual([]);
      });
    });
  }
});

describe("the de-slop revision of the contract (K-redesign §2.5)", () => {
  it("adds the control radius and the outer rhythm steps, and drops the glass highlight", () => {
    // 186 names in W0, less the inset glow line glass drew, plus three: 188 (the count itself is
    // held by the theme-identities revision below, which added to it).
    for (const name of ["--ui-radius-control", "--ui-stack-0", "--ui-stack-4"]) {
      expect(TOKEN_NAMES).toContain(name);
    }
    expect(TOKEN_NAMES.includes("--ui-glass-highlight" as never)).toBe(false);
  });

  it("has no second name for the neutral fill's label", () => {
    // `--ui-fg-on-emphasis` said what `--ui-tone-neutral-emphasis-fg` says (user decision,
    // 2026-09-18); a component labelling the neutral emphasis fill reads the tone token.
    expect(TOKEN_NAMES.includes("--ui-fg-on-emphasis" as never)).toBe(false);
    expect(TOKEN_NAMES).toContain("--ui-tone-neutral-emphasis-fg");
  });

  it("bridges the control radius, so a pressable control reads it as rounded-control", () => {
    // `@theme inline { … }` is a block with no selector, which the CSS reader does not file, so the
    // bridge line is matched in the comment-stripped sheet.
    const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));
    expect(sheet).toMatch(/@theme inline\s*\{[^}]*--radius-control:\s*var\(--ui-radius-control\);/);
  });
});

describe("the theme-identities revision of the contract (2026-09-19)", () => {
  // Nothing about size is shared between themes any more: each sets its own space unit, its own
  // rungs and its own control padding, and the chrome and reading faces are two names. The
  // presence / reveal / layout motion reads tokens of its own, and the app window has a hook with
  // tokens behind it. 188 + 1 (the space unit) + 1 (the chrome face) + 9 (the shell) + 11 (motion)
  // = 210.
  it("adds the space unit, the chrome face, the shell group and the motion names", () => {
    for (const name of [
      "--ui-space-unit",
      "--ui-font-ui",
      "--ui-shell-field",
      "--ui-shell-wash-1",
      "--ui-shell-wash-2",
      "--ui-shell-nav-bg",
      "--ui-shell-main-bg",
      "--ui-shell-line",
      "--ui-shell-gap",
      "--ui-shell-radius",
      "--ui-shell-shadow",
      "--ui-dur-enter",
      "--ui-dur-exit",
      "--ui-ease-enter",
      "--ui-ease-exit",
      "--ui-enter-shift",
      "--ui-enter-scale",
      "--ui-enter-blur",
      "--ui-dur-reveal",
      "--ui-reveal-blur",
      "--ui-dur-layout",
      "--ui-ease-layout",
    ]) {
      expect(TOKEN_NAMES).toContain(name);
    }
    expect(TOKEN_GROUPS.find((group) => group.id === "shell")?.names.length).toBe(9);
    expect(TOKEN_NAMES.length).toBe(210);
  });

  it("bridges the space unit, the chrome face and the body rung to Tailwind and body", () => {
    // With `--spacing` inlined, every `h-8` / `px-2` / `gap-3` / `size-4` / `w-64` a component
    // spells computes from the theme's unit; with `--text-sm` inlined, its size and line-height are
    // the theme's body rung. The chrome face reaches everything through `body`, and a reading
    // surface opts into `font-sans`.
    const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));
    const bridge = /@theme inline\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(bridge).toMatch(/--spacing:\s*var\(--ui-space-unit\);/);
    expect(bridge).toMatch(/--font-ui:\s*var\(--ui-font-ui\);/);
    expect(bridge).toMatch(/--font-sans:\s*var\(--ui-font-sans\);/);
    expect(bridge).toMatch(/--text-sm:\s*var\(--ui-text-body-size\);/);
    expect(bridge).toMatch(/--text-sm--line-height:\s*var\(--ui-text-body-lh\);/);
    expect(bridge).toMatch(/--text-xs:\s*var\(--ui-text-small-size\);/);
    expect(sheet).toMatch(/\bbody\s*\{[^}]*font-family:\s*var\(--ui-font-ui\);/);
  });

  it("keeps Primer at today's rendering: Tailwind's stock unit and rungs, one face, no field", () => {
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    const light = primer.analysis.modes.light;
    expect(light.get("--ui-space-unit")).toBe("0.25rem");
    expect(light.get("--ui-text-body-size")).toBe("0.875rem");
    expect(light.get("--ui-text-body-lh")).toBe("calc(1.25 / 0.875)");
    expect(light.get("--ui-text-small-size")).toBe("0.75rem");
    expect(light.get("--ui-text-small-lh")).toBe("calc(1 / 0.75)");
    expect(light.get("--ui-font-ui")).toBe("var(--ui-font-sans)");
    expect(light.get("--ui-shell-field")).toBe("var(--ui-canvas)");
    expect(light.get("--ui-shell-gap")).toBe("0px");
    expect(light.get("--ui-shell-radius")).toBe("0px");
    expect(light.get("--ui-enter-scale")).toBe("1");
    expect(light.get("--ui-enter-blur")).toBe("0px");
  });

  it("gives the presence rules a token for every motion property they animate", () => {
    // The rules in theme.css read only tokens for what moves: a theme that wants no motion sets
    // zeros, one that wants steps sets a `steps()` easing. A rule that spelled a literal duration
    // or shift would move the same way in every theme.
    const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));
    const presence = /\[data-presence="enter"\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(presence).toMatch(/var\(--ui-dur-enter\)\s+var\(--ui-ease-enter\)/);
    const layout = /\[data-layout-motion\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(layout).toMatch(/transition-duration:\s*var\(--ui-dur-layout\)/);
    expect(layout).toMatch(/transition-timing-function:\s*var\(--ui-ease-layout\)/);
    const reveal = /\[data-reveal\]\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(reveal).toMatch(/var\(--ui-dur-reveal\)/);
    const animated = [
      "--ui-enter-shift",
      "--ui-enter-scale",
      "--ui-enter-blur",
      "--ui-reveal-blur",
    ];
    for (const name of animated) {
      expect(sheet, `${name} is read by a keyframe`).toContain(`var(${name})`);
    }
    // Everything stops under the gallery's switch and the system preference.
    expect(sheet).toMatch(
      /:root\[data-motion="reduced"\]\s*:is\(\[data-presence\],\s*\[data-backdrop\],\s*\[data-reveal\],\s*\.ui-live\)\s*\{\s*animation:\s*none;/,
    );
    expect(sheet).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

describe("theme import order", () => {
  // In dark, a theme takes every token its dark rule leaves out from its own base rule. That base
  // rule ties with github.css's dark rule (`:root.dark`) on specificity and wins only by coming
  // later in the sheet, so an entry stylesheet must import github.css before the other themes:
  // the other way round, Frost and Console in dark would take Primer's dark values for those
  // tokens.
  const GALLERY = join(REPO_ROOT, "packages", "ui-gallery");
  const entries: Record<string, string> = {
    web: join(WEB_DIR, "src", "styles.css"),
    ...(existsSync(GALLERY) ? { gallery: join(GALLERY, "src", "styles.css") } : {}),
  };
  const IMPORT = /@import\s+["']@prismshadow\/penguin-ui\/themes\/([\w-]+)\.css["']/g;

  for (const [name, file] of Object.entries(entries)) {
    it(`${name}: imports every theme once, the default (${DEFAULT_THEME_ID}.css) first`, () => {
      const themes = [...stripCssComments(readFileSync(file, "utf8")).matchAll(IMPORT)].map(
        (m) => m[1],
      );
      expect(themes[0], `${file} imports its themes as ${themes.join(", ")}`).toBe(
        DEFAULT_THEME_ID,
      );
      expect([...themes].sort()).toEqual([...THEME_IDS].sort());
    });
  }
});

describe("token reads", () => {
  // A name a component or a recipe reads but no theme declares computes to nothing: a removed token
  // still read by a recipe (Frost's glass read the inset highlight) leaves the declaration invalid
  // at computed-value time, silently, in every theme. So every `--ui-*` name the source spells —
  // in stylesheets and in string literals, never in comments — must be in the contract.
  const GALLERY = join(REPO_ROOT, "packages", "ui-gallery", "src");
  const roots = {
    ui: SRC_DIR,
    web: join(WEB_DIR, "src"),
    ...(existsSync(GALLERY) ? { gallery: GALLERY } : {}),
  };
  const scan = scanSourceRoots(roots, { repoRoot: REPO_ROOT });
  const contract = new Set<string>(TOKEN_NAMES);
  const NAME = /--ui-[a-z0-9]+(?:-[a-z0-9]+)*/g;

  /**
   * The whole names in one piece of text. A name that goes on past what the pattern reads is only a
   * prefix, built at runtime or written as a wildcard — `--ui-tone-${tone}-fg`, `--ui-h${n}-size`,
   * `--ui-chart-*` — and is not judged.
   */
  const namesIn = (text: string, openEnd: boolean) =>
    [...text.matchAll(NAME)].filter((m) => {
      const end = m.index + m[0].length;
      return text[end] !== "-" && !(openEnd && end === text.length);
    });

  const spelled = (file: SourceFile): { name: string; line: number }[] => {
    if (file.name.endsWith(".css")) {
      return stripCssComments(file.text)
        .split("\n")
        .flatMap((text, i) => namesIn(text, false).map((m) => ({ name: m[0], line: i + 1 })));
    }
    return analyzeFile(file).strings.flatMap((chunk) =>
      namesIn(chunk.text, chunk.openEnd).map((m) => ({ name: m[0], line: chunk.line })),
    );
  };

  it("scans the package, the web app and the gallery when it exists, and finds reads in each", () => {
    expect(unscannedRoots(scan)).toEqual([]);
    // A name pattern or a chunk reader that stopped matching would pass the check below over nothing.
    for (const root of Object.keys(roots)) {
      const reads = scan.files.filter((file) => file.root === root).flatMap(spelled);
      expect(reads.length, `${root} spells no --ui-* name`).toBeGreaterThan(0);
    }
  });

  /**
   * Names the file spells that are not tokens. A family prefix (`startsWith("--ui-chart")`) names
   * tokens that exist; a removed or misspelt token prefixes none.
   */
  const strays = (file: SourceFile) =>
    spelled(file).filter(
      (found) =>
        !contract.has(found.name) && !TOKEN_NAMES.some((t) => t.startsWith(`${found.name}-`)),
    );

  it("reads whole names only — the check is exercised on known shapes", () => {
    const probe = (text: string) =>
      strays({
        root: "ui",
        rel: "probe.tsx",
        id: "packages/ui/src/probe.tsx",
        path: "/virtual/probe.tsx",
        name: "probe.tsx",
        text,
      }).map((found) => found.name);
    expect(
      probe(
        [
          'const a = "var(--ui-glass-highlight)";',
          'const b = "var(--ui-canvas)";',
          "const c = (t: string) => `var(--ui-tone-${t}-fg)`;",
          "const d = (n: number) => `var(--ui-h${n}-size)`;",
          'const e = "chart inks read --ui-chart-* through the bridge";',
          'const f = (name: string) => name.startsWith("--ui-chart");',
          "// --ui-comment-only is not read",
        ].join("\n"),
      ),
    ).toEqual(["--ui-glass-highlight"]);
  });

  it("name only contract tokens", () => {
    const found = scan.files
      // The test machinery spells names in its own messages.
      .filter((file) => !(file.root === "ui" && matchesPolicyPath(file.rel, ["testing/"])))
      .flatMap((file) => strays(file).map((stray) => `${file.id}:${stray.line} ${stray.name}`));
    expect(
      found,
      "Read a name tokens.ts lists, or add the name to the contract (and to every theme file).",
    ).toEqual([]);
  });
});
