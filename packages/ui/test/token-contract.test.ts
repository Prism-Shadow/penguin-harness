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
import {
  BUNDLED_FONT_FAMILIES,
  FONT_CJK_OPTIONS,
  FONT_LATIN_OPTIONS,
  SYSTEM_FONT,
  THEME_FONTS,
} from "../src/boot";
import {
  ACCENT_PRESETS,
  DEFAULT_THEME_ID,
  THEME_ACCENT_PRESETS,
  THEME_IDS,
  THEME_MODES,
  THEME_OWN_ACCENTS,
  TOKEN_GROUPS,
  TOKEN_NAMES,
} from "../src/tokens";
import type { ThemeId } from "../src/tokens";
import {
  accentProblems,
  analyzeFile,
  analyzeThemeFile,
  contractProblems,
  darkRepeats,
  matchesPolicyPath,
  modeDeclarations,
  parseCssRules,
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
const read = (rel: string) => readFileSync(join(SRC_DIR, rel), "utf8");

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

      it("declares the accent presets tokens.ts lists for it, each setting the six accent names", () => {
        // A preset is the one rule outside the canonical two that may set a token: the six accent
        // names, on the theme's own root, in `@layer ui-accent`; a dark rule lifts what dark
        // changes. The ids and their order are the picker's, so tokens.ts and the file agree.
        expect(accentProblems(analysis, ACCENT_PRESETS[theme.id])).toEqual([]);
      });
    });
  }
});

describe("the accent presets, per theme (2026-09-19)", () => {
  // Each theme lists its own presets and values (user decision): Primer the five ids and values
  // the Web App has always had, so it moves no pixel; Frost warm and muted; Console terminal
  // hues. A theme's rules match only its own root, so a stored preset another theme lists paints
  // nothing under it and comes back when that theme returns.
  const PRIMER_TODAY: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    blue: {
      "--ui-accent": "#2563eb",
      "--ui-accent-hover": "#1d4ed8",
      "--ui-accent-active": "#1e40af",
      "--ui-accent-fg": "#ffffff",
      "--ui-accent-muted": "rgb(37 99 235 / 0.12)",
      "--ui-accent-line": "rgb(37 99 235 / 0.5)",
    },
    green: {
      "--ui-accent": "#15803d",
      "--ui-accent-hover": "#166534",
      "--ui-accent-active": "#14532d",
      "--ui-accent-fg": "#ffffff",
      "--ui-accent-muted": "rgb(21 128 61 / 0.12)",
      "--ui-accent-line": "rgb(21 128 61 / 0.5)",
    },
    violet: {
      "--ui-accent": "#7c3aed",
      "--ui-accent-hover": "#6d28d9",
      "--ui-accent-active": "#5b21b6",
      "--ui-accent-fg": "#ffffff",
      "--ui-accent-muted": "rgb(124 58 237 / 0.12)",
      "--ui-accent-line": "rgb(124 58 237 / 0.5)",
    },
    rose: {
      "--ui-accent": "#be123c",
      "--ui-accent-hover": "#9f1239",
      "--ui-accent-active": "#881337",
      "--ui-accent-fg": "#ffffff",
      "--ui-accent-muted": "rgb(190 18 60 / 0.12)",
      "--ui-accent-line": "rgb(190 18 60 / 0.5)",
    },
    amber: {
      "--ui-accent": "#b45309",
      "--ui-accent-hover": "#92400e",
      "--ui-accent-active": "#78350f",
      "--ui-accent-fg": "#ffffff",
      "--ui-accent-muted": "rgb(180 83 9 / 0.12)",
      "--ui-accent-line": "rgb(180 83 9 / 0.5)",
    },
  };

  /**
   * The one dark lift Primer carries (2026-09-29): rose-700 was a 3:1 mark only on the old
   * pure-black dark; on the lifted surfaces dark takes rose-600, with the 700 / 800 steps as
   * hover and active and the same white label. Light stays byte for byte.
   */
  const PRIMER_DARK_LIFTS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    rose: {
      "--ui-accent": "#e11d48",
      "--ui-accent-hover": "#be123c",
      "--ui-accent-active": "#9f1239",
      "--ui-accent-muted": "rgb(225 29 72 / 0.12)",
      "--ui-accent-line": "rgb(225 29 72 / 0.5)",
    },
  };

  it("keeps Primer's five ids and light values byte for byte, and lifts only rose in dark", () => {
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    expect([...THEME_ACCENT_PRESETS.github]).toEqual(Object.keys(PRIMER_TODAY));
    for (const [id, values] of Object.entries(PRIMER_TODAY)) {
      const rules = primer.analysis.accents.get(id);
      expect(rules, id).toBeDefined();
      expect(Object.fromEntries(rules!.light), id).toEqual(values);
      expect(Object.fromEntries(rules!.dark), `${id} in dark`).toEqual(PRIMER_DARK_LIFTS[id] ?? {});
    }
  });

  it("gives every theme its own list (Console's has six), with no id shared between two themes", () => {
    const all = THEME_IDS.flatMap((id) => THEME_ACCENT_PRESETS[id]);
    expect(all.length).toBe(new Set(all).size);
    // Console's own accent went black and white (2026-09-30); the orange it had is now its first
    // preset, so its list is one longer.
    const listed: Readonly<Record<ThemeId, number>> = { github: 5, modern: 5, geek: 6 };
    for (const id of THEME_IDS) expect(THEME_ACCENT_PRESETS[id].length, id).toBe(listed[id]);
    expect(THEME_ACCENT_PRESETS.geek[0]).toBe("orange");
  });

  it("spells each theme's own accent (the neutral choice) in tokens.ts as the CSS does", () => {
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      for (const mode of THEME_MODES) {
        expect(theme.analysis.modes[mode].get("--ui-accent"), `${theme.id} ${mode}`).toBe(
          THEME_OWN_ACCENTS[theme.id][mode],
        );
      }
    }
  });

  it("no longer lives in theme.css, and theme.css still declares the ui-accent layer after ui-theme", () => {
    const sheet = read("theme.css");
    const presets = parseCssRules(sheet).filter((rule) => /data-accent=/.test(rule.selector));
    expect(presets.map((rule) => `${rule.line}: ${rule.selector}`)).toEqual([]);
    expect(stripCssComments(sheet)).toMatch(/@layer ui-theme, ui-accent, ui-font;/);
  });

  it("is one value per mode in Frost and Console: the family derives from --ui-accent", () => {
    // The owner asked for less redundancy in the switching code (2026-09-29): a preset no longer
    // restates hover, active, wash and line — the theme derives them — and keeps the theme's
    // label ink for the mode. Primer's presets stay literal (the check above pins them).
    for (const theme of THEMES) {
      if (theme.status !== "filled" || theme.id === DEFAULT_THEME_ID) continue;
      for (const [id, rules] of theme.analysis.accents) {
        expect([...rules.light.keys()], `${theme.id} ${id} light`).toEqual(["--ui-accent"]);
        // A dark rule lifts the accent and nothing else; a preset that holds across modes
        // (Console's orange takes black ink in dark) has none.
        expect(["", "--ui-accent"], `${theme.id} ${id} dark`).toContain(
          [...rules.dark.keys()].join(","),
        );
      }
      for (const mode of THEME_MODES) {
        const values = theme.analysis.modes[mode];
        for (const name of [
          "--ui-accent-hover",
          "--ui-accent-active",
          "--ui-accent-muted",
          "--ui-accent-line",
        ]) {
          expect(values.get(name), `${theme.id} ${mode} ${name}`).toMatch(/var\(--ui-accent\)/);
        }
      }
    }
  });
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
  // = 210; the structure revision below adds 5 more.
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
    // 215, plus the integration round's four (the emphasis ink and the switch's three), plus
    // the chart round's nine (two more series, the reference line, six geometry names), plus
    // the bar outline's three, plus the knob's hairline edge (2026-09-30), plus the update
    // mark's fill (W1, the same day).
    expect(TOKEN_NAMES.length).toBe(233);
  });

  it("adds the structure group behind the tree and field hooks (round 2)", () => {
    // A host indents a tree row by the inset and the indent per level, so a theme's connector
    // rules land on the columns the host used; a field's label column and gap are the theme's.
    // 210 + 5 = 215.
    const structure = TOKEN_GROUPS.find((group) => group.id === "structure");
    expect(structure?.names).toEqual([
      "--ui-tree-inset",
      "--ui-tree-indent",
      "--ui-tree-guide",
      "--ui-field-label-w",
      "--ui-field-gap",
    ]);
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    // Today's file tree: a 0.5rem inset and 0.875rem per level.
    expect(primer.analysis.modes.light.get("--ui-tree-inset")).toBe("0.5rem");
    expect(primer.analysis.modes.light.get("--ui-tree-indent")).toBe("0.875rem");
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

describe("the integration revision of the contract (2026-09-29)", () => {
  // The calm dark needs a second ink for headings; the switch needs its track and knobs named
  // so a knob can be held to 3:1 against its track; the user's font pairing needs every sans
  // stack to read the CJK face, and a layer of its own so a chosen face beats the theme's rules.
  it("adds the emphasis ink and the switch group", () => {
    expect(TOKEN_GROUPS.find((group) => group.id === "color-text")?.names).toContain(
      "--ui-fg-emphasis",
    );
    expect(TOKEN_GROUPS.find((group) => group.id === "controls")?.names).toEqual([
      "--ui-switch-track",
      "--ui-switch-knob",
      "--ui-switch-knob-on",
      "--ui-switch-knob-line",
    ]);
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      const light = theme.analysis.modes.light;
      // In light the emphasis ink is the body ink; the on-knob follows the accent's label.
      expect(light.get("--ui-fg-emphasis"), theme.id).toBe("var(--ui-fg)");
      expect(light.get("--ui-switch-knob-on"), theme.id).toBe("var(--ui-accent-fg)");
    }
  });

  it("keeps Primer's light ink, faces and switch as today's, and moves only its dark", () => {
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    const light = primer.analysis.modes.light;
    expect(light.get("--ui-fg")).toBe("var(--color-gray-900)");
    expect(light.get("--ui-switch-track")).toBe("var(--color-gray-200)");
    expect(light.get("--ui-switch-knob")).toBe("#ffffff");
    // The sans stack reads the CJK face where it named the two system faces: the same list.
    expect(light.get("--ui-font-sans")).toContain("var(--ui-font-cjk)");
    expect(light.get("--ui-font-cjk")).toBe('"PingFang SC", "Microsoft YaHei"');
    // Dark lifts off pure black and calms the body ink: the ramp, not the app's #000.
    const dark = primer.analysis.modes.dark;
    expect(dark.get("--color-gray-950")).not.toBe("#000000");
    expect(dark.get("--color-gray-100")).not.toBe(light.get("--color-gray-100"));
  });

  it("resolves the font pairing in theme.css's ui-font layer, for every face the lists offer", () => {
    // Every chosen face has a rule; a Latin choice sets the reading sans (and keeps the CJK face
    // in its stack), a CJK choice sets the CJK face; no pairing rule touches the mono or the
    // chrome face directly — Console's mono chrome is its identity, not a reading preference.
    const rules = parseCssRules(read("theme.css")).filter((rule) =>
      /data-font-(?:latin|cjk)=/.test(rule.selector),
    );
    const byAttribute = (attr: string, id: string) =>
      rules.find((rule) => rule.selector === `:root[data-font-${attr}="${id}"]`);
    for (const option of FONT_LATIN_OPTIONS) {
      if (option.id === "theme") continue;
      const rule = byAttribute("latin", option.id);
      expect(rule, `data-font-latin="${option.id}"`).toBeDefined();
      expect(rule!.declarations.map((d) => d.name)).toEqual(["--ui-font-sans"]);
      expect(rule!.declarations[0]!.value).toContain("var(--ui-font-cjk)");
    }
    for (const option of FONT_CJK_OPTIONS) {
      if (option.id === "theme") continue;
      const rule = byAttribute("cjk", option.id);
      expect(rule, `data-font-cjk="${option.id}"`).toBeDefined();
      expect(rule!.declarations.map((d) => d.name)).toEqual(["--ui-font-cjk"]);
    }
    for (const rule of rules) {
      expect(rule.atRules, rule.selector).toEqual(["@layer ui-font"]);
      expect(rule.declarations.map((d) => d.name)).not.toContain("--ui-font-mono");
      expect(rule.declarations.map((d) => d.name)).not.toContain("--ui-font-ui");
    }
    // A chosen face reaches every theme: each sans stack reads the CJK face, and the chrome
    // face is the sans (Primer, Frost) or the mono (Console), never a third stack.
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      for (const mode of THEME_MODES) {
        const values = new Map([...theme.analysis.modes.light, ...theme.analysis.modes[mode]]);
        expect(values.get("--ui-font-sans"), `${theme.id} ${mode}`).toContain("var(--ui-font-cjk)");
        expect(["var(--ui-font-sans)", "var(--ui-font-mono)"], `${theme.id} ${mode}`).toContain(
          values.get("--ui-font-ui"),
        );
      }
    }
  });

  it("shares the eyebrow rung and the display ink in theme.css, once for every theme", () => {
    // The three eyebrow recipes were one recipe reading the h6 rung; a theme adds only its ink.
    const rules = parseCssRules(read("theme.css"));
    const eyebrow = rules.find((rule) => rule.selector === ".ui-eyebrow");
    expect(eyebrow?.atRules).toEqual(["@layer ui-theme"]);
    expect(eyebrow?.declarations.map((d) => `${d.name}: ${d.value}`)).toEqual([
      "font-family: var(--ui-h6-font)",
      "font-size: var(--ui-h6-size)",
      "line-height: var(--ui-h6-lh)",
      "font-weight: var(--ui-h6-weight)",
      "letter-spacing: var(--ui-h6-tracking)",
      "text-transform: var(--ui-h6-transform)",
    ]);
    const display = rules.find((rule) => rule.selector === ".ui-display");
    expect(display?.declarations.map((d) => `${d.name}: ${d.value}`)).toEqual([
      "color: var(--ui-fg-emphasis)",
    ]);
    for (const id of THEME_IDS) {
      const own = parseCssRules(read(`themes/${id}.css`)).filter((rule) =>
        /\.ui-eyebrow\b/.test(rule.selector),
      );
      for (const rule of own) {
        expect(
          rule.declarations.map((d) => d.name),
          `${id}: ${rule.selector}`,
        ).toEqual(["color"]);
      }
    }
  });
});

describe("the update mark (W1, 2026-09-30)", () => {
  // The update dot says "something new down this path", which is not a tone's judgement, so it
  // has a colour of its own. It never carries the meaning alone — its anchor names what is new —
  // so no contrast floor applies: every theme and mode declares a value, and that is the check.
  it("is a group of its own, bridged to bg-mark-new", () => {
    expect(TOKEN_GROUPS.find((group) => group.id === "color-marks")?.names).toEqual([
      "--ui-mark-new",
    ]);
    const sheet = stripCssComments(readFileSync(join(SRC_DIR, "theme.css"), "utf8"));
    expect(sheet).toMatch(/@theme inline\s*\{[^}]*--color-mark-new:\s*var\(--ui-mark-new\);/);
  });

  it("is declared by every theme in both modes", () => {
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      for (const mode of THEME_MODES) {
        const value = modeDeclarations(theme.analysis, mode).get("--ui-mark-new");
        expect(value, `${theme.id} ${mode}`).toBeTruthy();
      }
    }
  });

  it("keeps Primer's pale notification red, one value in both modes", () => {
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    expect(primer.analysis.modes.light.get("--ui-mark-new")).toBe("oklch(70.4% 0.191 22.216)");
    expect(primer.analysis.modes.dark.has("--ui-mark-new")).toBe(false);
  });
});

describe("the chart style tokens (round 7)", () => {
  // A chart draws with tokens the app reads once per theme: the palette in fixed roles, a
  // reference line, and the geometry. Primer's are today's charts; a curve is one of the three
  // keywords the app knows, and the geometry is written in the units the app parses.
  const chart = TOKEN_GROUPS.find((group) => group.id === "chart");

  it("names the eight series, the reference line and the six geometry values", () => {
    expect(chart?.names).toEqual([
      "--ui-chart-1",
      "--ui-chart-2",
      "--ui-chart-3",
      "--ui-chart-4",
      "--ui-chart-5",
      "--ui-chart-6",
      "--ui-chart-7",
      "--ui-chart-8",
      "--ui-chart-ref",
      "--ui-chart-cache-read",
      "--ui-chart-cache-write",
      "--ui-chart-output",
      "--ui-chart-grid",
      "--ui-chart-axis",
      "--ui-chart-bar-fill",
      "--ui-chart-bar-radius",
      "--ui-chart-line-width",
      "--ui-chart-point-radius",
      "--ui-chart-curve",
      "--ui-chart-area-opacity",
      "--ui-chart-bar-stroke",
      "--ui-chart-bar-stroke-color",
      "--ui-chart-bar-opacity",
    ]);
  });

  it("keeps Primer at today's geometry, and its palette at the steps that read on white", () => {
    // The one Primer change of the theme work (2026-09-30): amber, sky, emerald, teal and orange
    // move from their 500 steps (2.2–2.9:1 on white) to the 600 steps the app's dark series
    // already used; violet, rose and fuchsia clear 3:1 at 500 and stay.
    const primer = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
    if (primer === undefined || primer.status !== "filled") throw new Error("Primer is filled");
    const light = primer.analysis.modes.light;
    expect(light.get("--ui-chart-1")).toBe("oklch(60.6% 0.25 292.717)"); // violet-500
    expect(light.get("--ui-chart-2")).toBe("oklch(66.6% 0.179 58.318)"); // amber-600
    expect(light.get("--ui-chart-3")).toBe("oklch(58.8% 0.158 241.966)"); // sky-600
    expect(light.get("--ui-chart-4")).toBe("oklch(64.5% 0.246 16.439)"); // rose-500
    expect(light.get("--ui-chart-5")).toBe("oklch(59.6% 0.145 163.225)"); // emerald-600
    expect(light.get("--ui-chart-6")).toBe("oklch(66.7% 0.295 322.15)"); // fuchsia-500
    expect(light.get("--ui-chart-7")).toBe("oklch(60% 0.118 184.704)"); // teal-600
    expect(light.get("--ui-chart-8")).toBe("oklch(64.6% 0.222 41.116)"); // orange-600
    expect(light.get("--ui-chart-ref")).toBe("var(--ui-chart-2)");
    expect(light.get("--ui-chart-bar-fill")).toBe("0.6");
    expect(light.get("--ui-chart-bar-radius")).toBe("0px");
    expect(light.get("--ui-chart-line-width")).toBe("2px");
    expect(light.get("--ui-chart-point-radius")).toBe("2.5px");
    expect(light.get("--ui-chart-curve")).toBe("linear");
    expect(light.get("--ui-chart-area-opacity")).toBe("0.1");
    // No outline and a solid fill: the bar as the app has always drawn it.
    expect(light.get("--ui-chart-bar-stroke")).toBe("0px");
    expect(light.get("--ui-chart-bar-stroke-color")).toBe("series");
    expect(light.get("--ui-chart-bar-opacity")).toBe("1");
    // Dark restates only what still differs from light: the timeline's emerald-400 work phase
    // and fuchsia-600.
    const dark = primer.analysis.modes.dark;
    expect(dark.get("--ui-chart-5")).toBe("oklch(76.5% 0.177 163.223)"); // emerald-400
    expect(dark.get("--ui-chart-6")).toBe("oklch(59.1% 0.293 322.896)"); // fuchsia-600
  });

  it("writes the geometry in the units the app parses, and a curve the app knows", () => {
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      for (const mode of THEME_MODES) {
        const values = new Map([...theme.analysis.modes.light, ...theme.analysis.modes[mode]]);
        const at = `${theme.id} ${mode}`;
        expect(values.get("--ui-chart-curve"), at).toMatch(/^(?:linear|smooth|step)$/);
        for (const name of [
          "--ui-chart-bar-fill",
          "--ui-chart-area-opacity",
          "--ui-chart-bar-opacity",
        ]) {
          expect(Number(values.get(name)), `${at} ${name}`).toBeGreaterThanOrEqual(0);
          expect(Number(values.get(name)), `${at} ${name}`).toBeLessThanOrEqual(1);
        }
        for (const name of [
          "--ui-chart-bar-radius",
          "--ui-chart-line-width",
          "--ui-chart-point-radius",
          "--ui-chart-bar-stroke",
        ]) {
          expect(values.get(name), `${at} ${name}`).toMatch(/^\d+(?:\.\d+)?px$/);
        }
        // The outline's colour is the exact keyword for the bar's own series colour, or a
        // colour the app can use as one.
        expect(values.get("--ui-chart-bar-stroke-color"), `${at} bar-stroke-color`).toMatch(
          /^(?:series|#[0-9a-f]{3,8}|(?:rgb|hsl|oklch|color-mix|var)\()/i,
        );
      }
    }
  });

  it("differs between the themes in geometry, not only in colour", () => {
    const geometry = (id: ThemeId) => {
      const theme = THEMES.find((entry) => entry.id === id);
      if (theme === undefined || theme.status !== "filled") return null;
      const light = theme.analysis.modes.light;
      return ["bar-fill", "bar-radius", "line-width", "curve"]
        .map((part) => light.get(`--ui-chart-${part}`))
        .join(" ");
    };
    const all = THEME_IDS.map(geometry).filter((value) => value !== null);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("the themes' own faces (round 6)", () => {
  // THEME_FONTS is what the Fonts page states as a theme's defaults; it must be what the theme
  // file's stacks name first — a bundled family by its declared name, or, for `System`, a stack
  // that names no bundled family at all. The pairing options name faces by the same names.
  const bundled = new Set<string>(Object.values(BUNDLED_FONT_FAMILIES));
  const firstFamily = (stack: string | undefined) =>
    (stack ?? "")
      .split(",")[0]!
      .trim()
      .replace(/^["']|["']$/g, "");
  const STACKS = { latin: "--ui-font-sans", cjk: "--ui-font-cjk", mono: "--ui-font-mono" } as const;

  it("names, for every theme, the family each stack puts first", () => {
    for (const theme of THEMES) {
      if (theme.status !== "filled") continue;
      for (const [role, token] of Object.entries(STACKS)) {
        const name = THEME_FONTS[theme.id][role as keyof typeof STACKS];
        const first = firstFamily(theme.analysis.modes.light.get(token));
        if (name === SYSTEM_FONT) {
          expect(bundled.has(first), `${theme.id} ${role}: ${first} is a bundled face`).toBe(false);
        } else {
          expect(first, `${theme.id} ${role}`).toBe(BUNDLED_FONT_FAMILIES[name]);
        }
      }
    }
  });

  it("offers the pairing's faces under the same names", () => {
    for (const option of [...FONT_LATIN_OPTIONS, ...FONT_CJK_OPTIONS]) {
      if (option.id === "theme" || option.id === "system") continue;
      expect(Object.keys(BUNDLED_FONT_FAMILIES), option.id).toContain(option.label);
    }
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
