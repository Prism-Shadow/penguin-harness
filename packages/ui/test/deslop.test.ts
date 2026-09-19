/**
 * The de-slop rules (K-redesign §3) over `packages/ui/src`.
 *
 * The W0 drafts copied the tells killaislop.com catalogues — an ambient gradient behind glass,
 * radius that eases on hover, a terminal costume, one-hue status boxes, 10–11 px uppercase
 * micro-titles, a tinted stop button — and none of them fails a type check or a contract test.
 * Each rule §3 marks as a guard is a check in `src/testing/deslop.ts`; this suite runs every one
 * over the package's markup (`.ts`, `.tsx`) and stylesheets, and the web app's suite runs the same
 * checks over `packages/web/src` with its own allowlist.
 *
 * The package holds itself to the rules outright. Where a rule names a home — the one spinner
 * file, the motion files, the pulse of a dot or a skeleton — it is in {@link POLICY}; an occurrence
 * a later wave removes would go in {@link ALLOWLIST} with that wave, and the list starts empty.
 *
 * A rule with nothing to read on this branch is a named skip, never a pass: the markup rules wait
 * for the first `.tsx` (the screens, #763; the modules, #764; the components, W1), and the
 * component rules (15, 16, 22) name the components they read and skip while none exists.
 * The rules §3 leaves to review — two badges per row, spacing steps per kind of child, nesting
 * across components, copy voice — are not here; the frontend skill carries them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_IDS, THEME_MODES } from "../src/tokens";
import {
  DESLOP_CHECKS,
  DESLOP_RULE_NUMBERS,
  DESLOP_RULES,
  LABEL_COMPONENTS,
  PAGE_HEADER_COMPONENTS,
  TABULAR_COMPONENTS,
  allowlistProblems,
  analyzeFile,
  analyzeThemeFile,
  deslopHits,
  isClassShaped,
  matchesPolicyPath,
  modeDeclarations,
  parseClassToken,
  scanSourceRoots,
  unscannedRoots,
} from "../src/testing";
import type {
  DeslopAllowlist,
  DeslopPolicy,
  DeslopRule,
  SourceFile,
  ThemeFileAnalysis,
} from "../src/testing";
import { REPO_ROOT, SRC_DIR } from "./helpers/paths";

/** The homes §3 names. Bare file names match wherever the file lands. */
const POLICY: DeslopPolicy = {
  // Rule 1: the chevron rotates; the sheet, the launcher fan and the drawer move.
  transformMotion: ["chevron.tsx", "sheet.tsx", "launcher.tsx", "drawer.tsx"],
  // Rule 3: keyframe-driven entrances longer than 200 ms. None in the package yet.
  entranceMotion: [],
  // Rule 6: the dot's live pulse, the skeleton's arrival pulse and the streaming caret.
  pulseHomes: ["dot.tsx", "skeleton.tsx", "streaming-caret.tsx"],
  // Rule 11: the one Spinner (K-redesign §5.1).
  spinnerHomes: ["components/icons/spinner/spinner.tsx"],
  // Rule 20: tokens only; hex colours in identity data and the avatar palette.
  tokensOnly: true,
  hexHomes: ["fixtures/", "avatar.ts"],
};

/** Occurrences a named wave removes, by root-relative path. The package starts with none. */
const ALLOWLIST: DeslopAllowlist = {};

/** Not UI: the test machinery spells the patterns the rules look for, and hooks.ts is a list. */
const NOT_UI = ["testing/", "hooks.ts"];

const SCAN = scanSourceRoots({ ui: SRC_DIR }, { repoRoot: REPO_ROOT });
const ACTIVE = SCAN.files.filter((file) => !matchesPolicyPath(file.rel, NOT_UI));
const relOf = (id: string) => id.slice("packages/ui/src/".length);

const MARKUP = /\.tsx?$/;
const hasTsx = ACTIVE.some((file) => file.name.endsWith(".tsx"));

/** Why a rule has nothing to read here yet, or null when it does. */
function nothingToRead(rule: DeslopRule, surface: "markup" | "stylesheet"): string | null {
  const active = ACTIVE.filter((f) => (surface === "markup" ? MARKUP : /\.css$/).test(f.name));
  if (surface === "stylesheet") return active.length > 0 ? null : "no stylesheet to read";
  if (rule === 21) {
    return active.some((f) => f.rel.startsWith("fixtures/") || /^strings.*\.ts$/.test(f.name))
      ? null
      : "no fixtures or strings dictionary yet";
  }
  if (!hasTsx) {
    return "no .tsx under packages/ui/src yet — the screens (#763), the modules (#764) and the W1 components are read when they land";
  }
  const named =
    rule === 15
      ? TABULAR_COMPONENTS
      : rule === 16
        ? LABEL_COMPONENTS
        : rule === 22
          ? PAGE_HEADER_COMPONENTS
          : null;
  if (named !== null) {
    const found = active.some((f) => analyzeFile(f).components.some((c) => named.includes(c.name)));
    if (!found) return `no ${named.join(" / ")} component yet`;
  }
  return null;
}

describe("de-slop rules over packages/ui/src", () => {
  it("scans the package source, and every allowlisted file is in it", () => {
    expect(unscannedRoots(SCAN)).toEqual([]);
    expect(Object.keys(ALLOWLIST).filter((rel) => !ACTIVE.some((f) => f.rel === rel))).toEqual([]);
  });

  for (const rule of DESLOP_RULE_NUMBERS) {
    for (const surface of ["markup", "stylesheet"] as const) {
      if (!DESLOP_CHECKS.some((c) => c.rule === rule && c.surface === surface)) continue;
      const title = `rule ${rule}: ${DESLOP_RULES[rule]} (${surface === "markup" ? "markup" : "stylesheets"})`;

      const extension = surface === "markup" ? MARKUP : /\.css$/;
      const reason = nothingToRead(rule, surface);
      if (reason !== null) {
        it.skip(`${title} — PENDING: ${reason}`, () => {});
        continue;
      }
      it(title, () => {
        const hits = deslopHits(
          ACTIVE.filter((f) => extension.test(f.name)),
          rule,
          POLICY,
          surface,
        );
        expect(
          allowlistProblems(hits, rule, ALLOWLIST, (hit) => relOf(hit.file)),
          `K-redesign §3 rule ${rule}: ${DESLOP_RULES[rule]}.`,
        ).toEqual([]);
      });
    }
  }
});

describe("theme values the rules reach", () => {
  // §2.4: Console keeps a condensed uppercase h1 (through .ui-display) and uppercases h6, the
  // group-label rung (through .ui-eyebrow). Nothing between is uppercased, and no heading rung is
  // set in the mono face — mono is for data.
  const themes = THEME_IDS.map((id) => {
    const rel = `themes/${id}.css`;
    const path = join(SRC_DIR, rel);
    const analysis: ThemeFileAnalysis | null = existsSync(path)
      ? analyzeThemeFile(readFileSync(path, "utf8"), id)
      : null;
    return { id, rel, analysis };
  });
  for (const { id, rel, analysis } of themes) {
    const title = `${rel}: headings h2–h5 are not uppercased and no heading is set in mono (rules 14, 16)`;
    if (analysis === null || analysis.isStub) {
      it.skip(`${title} — PENDING: the theme file is still a stub`, () => {});
      continue;
    }
    it(title, () => {
      const problems: string[] = [];
      for (const mode of THEME_MODES) {
        const values = modeDeclarations(analysis, mode);
        for (const level of [1, 2, 3, 4, 5, 6]) {
          const transform = values.get(`--ui-h${level}-transform`);
          if (level >= 2 && level <= 5 && transform !== undefined && transform !== "none") {
            problems.push(`${id} ${mode}: --ui-h${level}-transform is ${transform}`);
          }
          const font = values.get(`--ui-h${level}-font`) ?? "";
          if (/--ui-font-mono|monospace/.test(font)) {
            problems.push(`${id} ${mode}: --ui-h${level}-font is ${font}`);
          }
        }
      }
      expect(problems).toEqual([]);
    });
  }
});

describe("the rule checks, on known shapes", () => {
  const file = (rel: string, text: string): SourceFile => ({
    root: "ui",
    rel,
    id: `packages/ui/src/${rel}`,
    path: `/virtual/${rel}`,
    name: rel.slice(rel.lastIndexOf("/") + 1),
    text,
  });
  /** What each rule reports for a snippet, as `rule:found`. */
  const found = (rel: string, text: string, policy: DeslopPolicy = POLICY) =>
    DESLOP_RULE_NUMBERS.flatMap((rule) =>
      deslopHits([file(rel, text)], rule, policy).map((hit) => `${rule}:${hit.found}`),
    );
  const tsx = (jsx: string, policy: DeslopPolicy = POLICY) =>
    found("screens/probe.tsx", `export function Probe() { return ${jsx}; }`, policy);
  /** The web app's reading of rule 20: palette classes are not refused, so other rules show alone. */
  const PALETTE_OK: DeslopPolicy = { ...POLICY, tokensOnly: false };

  it("tell class strings from prose, and split variants from the utility", () => {
    expect(isClassShaped("hover:scale-105")).toBe(true);
    expect(isClassShaped("[&>svg]:size-4")).toBe(true);
    expect(isClassShaped("uppercase")).toBe(true);
    expect(isClassShaped("Uppercase")).toBe(false);
    expect(isClassShaped("letters.")).toBe(false);
    expect(isClassShaped("sm")).toBe(false);
    expect(parseClassToken("dark:hover:!bg-gray-800")).toEqual({
      variants: ["dark", "hover"],
      utility: "bg-gray-800",
    });
    expect(parseClassToken("[&_[role=tab]]:text-fg")).toEqual({
      variants: ["[&_[role=tab]]"],
      utility: "text-fg",
    });
    // A dictionary sentence is not classes; a lookup table is.
    expect(
      found("strings.ts", 'export const S = { hint: "Names are shown in uppercase" };'),
    ).toEqual([]);
    expect(found("parts.ts", 'export const LABEL = "text-xs uppercase";')).toEqual([
      "14:uppercase",
    ]);
    // Comments and interpolation-adjacent fragments are never read.
    expect(
      found("parts.ts", "// transition-all\nexport const c = (n: number) => `duration-${n}`;"),
    ).toEqual([]);
  });

  it("rule 1 — transition properties", () => {
    expect(tsx('<i className="transition-all" />')).toEqual(["1:transition-all"]);
    expect(tsx('<i className="transition" />')).toEqual(["1:transition"]);
    expect(tsx('<i className="transition-[width]" />')).toEqual(["1:transition-[width]"]);
    expect(tsx('<i className="transition-transform" />')).toEqual(["1:transition-transform"]);
    expect(
      found(
        "components/chevron.tsx",
        'export const C = () => <i className="transition-transform" />;',
      ),
    ).toEqual([]);
    expect(
      tsx('<i className="transition-colors transition-opacity transition-[color,opacity]" />'),
    ).toEqual([]);
    expect(
      found(
        "x.css",
        ".a { transition: all 150ms; }\n.b { transition: 150ms ease; }\n.c { transition: color 150ms, opacity 150ms; }",
      ),
    ).toEqual(["1:transition: all", "1:transition: all"]);
    expect(found("x.css", ".a { transition-property: color, border-radius; }")).toEqual([
      "1:transition-property: border-radius",
    ]);
  });

  it("rule 2 — hover and press transforms", () => {
    expect(
      tsx('<i className="hover:scale-110 active:scale-95 group-hover:-translate-y-0.5" />'),
    ).toEqual(["2:hover:scale-110", "2:active:scale-95", "2:group-hover:-translate-y-0.5"]);
    expect(tsx('<i className="scale-110 rotate-180" />')).toEqual([]);
    expect(found("x.css", ".a:hover { transform: scale(1.05); }")).toEqual([
      "2:.a:hover { transform: scale(1.05) }",
    ]);
  });

  it("rule 3 — durations", () => {
    expect(
      tsx('<i className="duration-150 duration-200 duration-[var(--ui-dur-fast)]" />'),
    ).toEqual([]);
    expect(tsx('<i className="duration-100 duration-300 duration-[250ms]" />')).toEqual([
      "3:duration-100",
      "3:duration-300",
      "3:duration-[250ms]",
    ]);
    const entrance = { ...POLICY, entranceMotion: ["screens/probe.tsx"] };
    expect(
      found(
        "screens/probe.tsx",
        'export const P = () => <i className="duration-300" />;',
        entrance,
      ),
    ).toEqual([]);
    expect(
      found("x.css", ".a { transition: color 160ms; }\n.b { transition-duration: 90ms; }"),
    ).toEqual(["3:transition-duration: 90ms"]);
  });

  it("rule 4 — nested radius", () => {
    expect(tsx('<div className="rounded-lg p-3"><div className="rounded-md" /></div>')).toEqual([
      "4:<div> rounded-md in a padded rounded box",
    ]);
    expect(
      tsx(
        '<div className="rounded-lg p-3"><div className="rounded-[var(--radius-inner)]" /><span className="rounded-full" /></div>',
      ),
    ).toEqual([]);
    expect(tsx('<div className="rounded-lg px-3"><div className="rounded-md" /></div>')).toEqual(
      [],
    );
  });

  it("rule 5 — a clipping rounded box owns the border", () => {
    expect(
      tsx(
        '<div className="overflow-hidden rounded-md"><ul className="border border-line" /></div>',
      ),
    ).toEqual(["5:<ul> border inside a clipping rounded box"]);
    expect(
      tsx('<div className="overflow-hidden rounded-md border"><ul className="border-t" /></div>'),
    ).toEqual([]);
  });

  it("rule 6 — halos and pulses", () => {
    expect(tsx('<i className="animate-ping" />')).toEqual(["6:animate-ping"]);
    expect(tsx('<i className="animate-pulse" />')).toEqual(["6:animate-pulse"]);
    expect(tsx('<i className="ui-live animate-pulse" data-live="caret" />')).toEqual([]);
    expect(
      found(
        "components/skeleton/skeleton.tsx",
        'export const S = () => <i className="animate-pulse" />;',
      ),
    ).toEqual([]);
    expect(
      tsx('<i className="h-2 w-2 rounded-full bg-tone-success-fg ring-2 ring-tone-success-bg" />'),
    ).toEqual(["6:ring-tone-success-bg on a dot"]);
    expect(tsx('<i className="size-2 rounded-full ring-2 ring-canvas" />')).toEqual([]);
  });

  it("rule 7 — an icon in a tint of itself", () => {
    expect(
      tsx(
        '<span className="bg-tone-danger-bg text-tone-danger-fg"><span className="h-2.5 w-2.5 bg-current" /></span>',
      ),
    ).toEqual(["7:<span> holds only an icon, in danger ink on danger tint"]);
    expect(
      tsx('<span className="bg-red-50 text-red-600"><GlyphIcon d={x} /></span>', PALETTE_OK),
    ).toEqual(["7:<span> holds only an icon, in red ink on red tint"]);
    expect(
      tsx(
        '<span className="bg-tone-danger-bg text-tone-danger-fg"><GlyphIcon d={x} />{label}</span>',
      ),
    ).toEqual([]);
    expect(
      tsx(
        '<span className="bg-tone-danger-emphasis text-tone-danger-emphasis-fg"><GlyphIcon d={x} /></span>',
      ),
    ).toEqual([]);
  });

  it("rule 8 — coloured left-border callouts", () => {
    expect(tsx('<div className="border-l-4 border-tone-attention-line" />')).toEqual([
      "8:border-l-4 in a colour",
    ]);
    expect(found("x.css", ".q { @apply border-l-2 border-amber-400; }", PALETTE_OK)).toEqual([
      "8:border-l-2 in a colour",
    ]);
    expect(tsx('<div className="border-l-2 border-line" />')).toEqual([]);
  });

  it("rule 9 — tint and line of one hue", () => {
    expect(
      tsx('<div className="border-t border-tone-attention-line bg-tone-attention-bg" />'),
    ).toEqual(["9:attention: tint and line on one box"]);
    expect(
      found(
        "toast.ts",
        'export const K = { error: "border-red-200 bg-red-50 text-red-800" };',
        PALETTE_OK,
      ),
    ).toEqual(["9:red: tint and line on one box"]);
    expect(
      tsx('<div className="border border-line bg-tone-attention-bg text-tone-attention-fg" />'),
    ).toEqual([]);
    expect(tsx('<span className="border border-tone-danger-line text-tone-danger-fg" />')).toEqual(
      [],
    );
  });

  it("rule 10 — mood badges", () => {
    expect(tsx("<Badge>New</Badge>")).toEqual(["10:<Badge>New</Badge>"]);
    expect(tsx("<Badge>✨</Badge>")).toEqual(["10:<Badge>✨</Badge>"]);
    expect(
      found("beta.tsx", "export function BetaBadge() { return <Badge>beta</Badge>; }"),
    ).toEqual([]);
    expect(tsx("<Badge>Running</Badge>")).toEqual([]);
  });

  it("rule 11 — one spinner", () => {
    expect(
      tsx('<i className="animate-spin rounded-full border-2 border-t-transparent" />'),
    ).toEqual(["11:animate-spin", "11:border-t-transparent"]);
    expect(
      found(
        "components/icons/spinner/spinner.tsx",
        'export const S = () => <svg className="animate-spin" />;',
      ),
    ).toEqual([]);
  });

  it("rule 12 — rhythm steps", () => {
    expect(tsx('<div className="gap-0.5 gap-x-5 space-y-2.5 p-[3px]" />')).toEqual([
      "12:gap-0.5",
      "12:gap-x-5",
      "12:space-y-2.5",
      "12:p-[3px]",
    ]);
    expect(
      tsx(
        '<div className="gap-1 gap-1.5 space-y-3 p-4 px-2.5 gap-[var(--ui-stack-1)] -space-x-2" />',
      ),
    ).toEqual([]);
  });

  it("rule 13 — text rungs", () => {
    expect(tsx('<i className="text-[11px] text-[0.6875rem]" />')).toEqual([
      "13:text-[11px]",
      "13:text-[0.6875rem]",
    ]);
    expect(tsx('<i className="text-xs text-[0.85em] text-[var(--ui-text-code-size)]" />')).toEqual(
      [],
    );
  });

  it("rule 14 — uppercase and eyebrows", () => {
    expect(tsx('<i className="uppercase tracking-wide" />')).toEqual([
      "14:uppercase",
      "14:tracking-wide",
    ]);
    expect(tsx('<div><p className="ui-eyebrow">Group</p><h2>Title</h2></div>')).toEqual([
      "14:eyebrow directly above <h2>",
    ]);
    expect(tsx('<><Text variant="eyebrow">Group</Text><Heading level={3}>T</Heading></>')).toEqual([
      "14:eyebrow directly above <Heading>",
    ]);
    expect(tsx('<div><p className="ui-eyebrow">Group</p><ul /></div>')).toEqual([]);
    expect(
      found(
        "t.css",
        ".a .ui-eyebrow { text-transform: uppercase; }\n.b { text-transform: uppercase; }",
      ),
    ).toEqual(["14:.b { text-transform: uppercase }"]);
  });

  it("rules 15, 16, 22 — the named components", () => {
    expect(
      found("chip.tsx", 'export function StatChip() { return <span className="font-mono" />; }'),
    ).toEqual(["15:StatChip has no tabular-nums"]);
    expect(
      found("button.tsx", 'export function Button() { return <button className="font-mono" />; }'),
    ).toEqual(["16:font-mono in Button"]);
    expect(
      found("t.css", ".x .ui-frame > [data-slot=head] { font-family: var(--ui-font-mono); }"),
    ).toEqual(["16:.x .ui-frame > [data-slot=head] { font-family: var(--ui-font-mono) }"]);
    expect(
      found(
        "page-header.tsx",
        "export function PageHeader({ title, eyebrow }: { title: string; eyebrow?: string }) { return <h2>{title}</h2>; }",
      ),
    ).toEqual(["22:PageHeader takes an eyebrow"]);
  });

  it("rule 17 — one surface per region", () => {
    expect(
      tsx(
        '<div className="border bg-surface">{items.map((i) => <div className="rounded-md border bg-surface-muted" />)}</div>',
      ),
    ).toEqual(["17:<div> surface inside the surface at line 1"]);
    expect(
      tsx('<div className="border bg-surface"><span className="border bg-surface" /></div>'),
    ).toEqual([]);
  });

  it("rule 18 — decoration", () => {
    expect(
      tsx(
        '<i className="bg-gradient-to-r bg-[radial-gradient(circle,red,blue)] backdrop-blur-md" />',
      ),
    ).toEqual([
      "18:bg-gradient-to-r",
      "18:bg-[radial-gradient(circle,red,blue)]",
      "18:backdrop-blur-md",
    ]);
    expect(tsx('<i className="ui-glass backdrop-blur-md" />')).toEqual([]);
    expect(
      found(
        "t.css",
        ".ui-wash { background-image: radial-gradient(red, blue); }\n.hatch { background-image: repeating-linear-gradient(red, blue); }",
      ),
    ).toEqual(["18:.ui-wash { background-image: …gradient() }"]);
  });

  it("rule 19 — shadows", () => {
    expect(
      tsx(
        '<i className="shadow-md shadow-2xl shadow-black/10 drop-shadow-sm shadow" />',
        PALETTE_OK,
      ),
    ).toEqual([
      "19:shadow-md",
      "19:shadow-2xl",
      "19:shadow-black/10",
      "19:drop-shadow-sm",
      "19:shadow",
    ]);
    expect(
      tsx(
        '<i className="shadow-sm shadow-lg shadow-xl shadow-none shadow-[var(--ui-shadow-drawer)]" />',
      ),
    ).toEqual([]);
  });

  it("rule 20 — colour is tokens", () => {
    expect(
      tsx('<i className="bg-gray-100 dark:bg-surface text-white" style={{ color: "#2563eb" }} />'),
    ).toEqual(["20:bg-gray-100", "20:dark:bg-surface", "20:text-white", "20:#2563eb"]);
    expect(found("fixtures/data.ts", 'export const C = "#2563eb";')).toEqual([]);
    expect(found("screens/p.tsx", 'export const L = "trace file #001";')).toEqual([]);
    expect(
      found("x.tsx", 'export const X = () => <i className="bg-gray-100" />;', PALETTE_OK),
    ).toEqual([]);
  });

  it("hold an allowlist to its exact counts, so it only shrinks", () => {
    const hit = (rel: string, line: number) => ({
      rule: 13 as const,
      file: `packages/web/src/${rel}`,
      line,
      found: "text-[11px]",
    });
    const hits = [hit("a.tsx", 1), hit("a.tsx", 2), hit("b.tsx", 3), hit("c.tsx", 4)];
    const problems = allowlistProblems(
      hits,
      13,
      {
        "a.tsx": { 13: [1, "W4"] }, // two hits against one allowed: the second is new slop
        "c.tsx": { 13: [2, "W6"] }, // one left of two: the entry shrinks
        "d.tsx": { 13: [1, "W7"] }, // none left: the entry goes
        "e.tsx": { 12: [1, "W7"] }, // another rule's entry is not this rule's business
      },
      (h) => h.file.slice("packages/web/src/".length),
    );
    expect(problems).toEqual([
      "a.tsx: 2 where 1 are allowlisted (W4)\n    packages/web/src/a.tsx:1  text-[11px]\n    packages/web/src/a.tsx:2  text-[11px]",
      "b.tsx: 1 new\n    packages/web/src/b.tsx:3  text-[11px]",
      'c.tsx: 1 left of 2 — shrink the entry to [1, "W6"]',
      "d.tsx: none left of 1 (W7) — delete the entry",
    ]);
  });

  it("rule 21 — emoji in copy", () => {
    expect(found("fixtures/en.ts", 'export const T = { title: "✨ New" };')).toEqual(["21:✨"]);
    expect(found("strings-en.ts", 'export const S = { ok: "Done ✓", copy: "© 2026" };')).toEqual(
      [],
    );
  });
});
