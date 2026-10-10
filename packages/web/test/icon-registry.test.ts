/**
 * One registry of line glyphs: `ICONS` in the shared UI package, and the app's manifests built on
 * it (`NAV_ICONS`, `STAT_ICONS`, the grouping and sort options).
 *
 * A path typed out in a feature file is how one bin came to be drawn five ways and a redraw came to
 * reach one surface and not the others. Each theme now draws every registry glyph in a style of its
 * own, so a path left in a feature file would also look wrong in two themes out of three. So every
 * line glyph is a registry entry, named for what it draws, and a feature file reads it from there.
 * A near-copy of a registry glyph is not kept beside it either: the call site draws the
 * registry's, so a bin or a pencil looks the same everywhere.
 *
 * Both source roots are read. The only files that still spell out paths are the ones whose
 * drawings are not registry glyphs, listed in `OWN_DRAWINGS`. The allowlist is empty and stays
 * empty: a new path fails here as new until it moves into `ICONS`.
 *
 * Two shapes are counted: a `const *_ICON` whose value is path data, and a literal `d="M…"` on an
 * element. A computed path (a chart's line, a sparkline, the topology view's edges) is not a
 * literal and is not read.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources([".ts", ".tsx"]);

/**
 * Files whose drawings are not registry glyphs, by repo-relative id: the small marks drawn as
 * components on grids and stroke weights of their own, the provider logos, and the icon sets —
 * a registry glyph's other drawings (its Octicon, its pixel grid, its duotone body), keyed by
 * the glyph's name and never drawn on their own.
 */
const OWN_DRAWINGS: ReadonlySet<string> = new Set([
  "packages/ui/src/components/icons/marks/marks.tsx",
  "packages/ui/src/components/icons/chevron/chevron.tsx",
  "packages/ui/src/components/icons/logos/provider-logo.tsx",
  "packages/ui/src/components/icons/sets/octicons.ts",
  "packages/ui/src/components/icons/sets/pixel.ts",
  "packages/ui/src/components/icons/sets/duotone.ts",
]);

const SCANNED = SCAN.files.filter((file) => !OWN_DRAWINGS.has(file.id));

/** Glyph paths outside the registry, by repo-relative id: `[count, why]`. Empty, and kept empty. */
const ALLOWLIST: Readonly<Record<string, readonly [number, string]>> = {};

/** SVG path data: a moveto, then only path commands, numbers and separators. */
const PATH_DATA = /^[Mm][\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]*$/;

/** A string-valued expression's literal text (a template's pieces around its holes), or null. */
function stringText(node: ts.Expression): string | null {
  let expr = node;
  while (
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isParenthesizedExpression(expr)
  ) {
    expr = expr.expression;
  }
  if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) return expr.text;
  if (ts.isTemplateExpression(expr)) {
    return expr.head.text + expr.templateSpans.map((span) => span.literal.text).join("");
  }
  return null;
}

/** Every glyph path a source spells out, as "line: what". */
function glyphHits(path: string, text: string): string[] {
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const at = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      /_ICON$/.test(node.name.text) &&
      node.initializer !== undefined
    ) {
      const value = stringText(node.initializer);
      if (value !== null && PATH_DATA.test(value.trim()))
        hits.push(`${at(node)}: ${node.name.text}`);
    } else if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "d" &&
      node.initializer !== undefined
    ) {
      const init = node.initializer;
      const value = ts.isStringLiteral(init)
        ? init.text
        : ts.isJsxExpression(init) && init.expression !== undefined
          ? stringText(init.expression)
          : null;
      if (value !== null && PATH_DATA.test(value.trim())) hits.push(`${at(node)}: d="${value}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

describe("glyph paths outside the registry", () => {
  it("scans every source root, and finds each own-drawings file", () => {
    expectEveryRootScanned(SCAN);
    const ids = new Set(SCAN.files.map((file) => file.id));
    expect([...OWN_DRAWINGS].filter((id) => !ids.has(id))).toEqual([]);
  });

  it("are none: every line glyph is drawn from the registry", () => {
    const found = new Map(
      SCANNED.map((file) => [file.id, glyphHits(file.path, file.text)] as const).filter(
        ([, hits]) => hits.length > 0,
      ),
    );
    const problems: string[] = [];
    for (const id of new Set([...found.keys(), ...Object.keys(ALLOWLIST)])) {
      const hits = found.get(id) ?? [];
      const [allowed, why] = ALLOWLIST[id] ?? [0, ""];
      if (hits.length > allowed) {
        problems.push(
          `${id}: ${hits.length} where ${allowed} are allowlisted — draw it from ICONS\n    ${hits.join("\n    ")}`,
        );
      } else if (hits.length < allowed) {
        problems.push(
          hits.length === 0
            ? `${id}: none left of ${allowed} (${why}) — delete the entry`
            : `${id}: ${hits.length} left of ${allowed} — shrink the entry to [${hits.length}, "${why}"]`,
        );
      }
    }
    expect(
      problems,
      "A glyph belongs in the shared registry (ICONS), named for what it draws.",
    ).toEqual([]);
  });

  it("recognizes each shape — the check is exercised on known sources", () => {
    expect(
      glyphHits(
        "probe.tsx",
        [
          'const TRASH_ICON = "M4 6h16M9 6V4";',
          "const EYE_ICON = `${OUTLINE}M3 3l18 18`;",
          'export const Mark = () => <svg><path d="M12 5v14M5 12h14" /></svg>;',
          "export const Wrapped = () => <path d={'M9 5l7 7-7 7'} />;",
        ].join("\n"),
      ),
    ).toEqual(["1: TRASH_ICON", "2: EYE_ICON", '3: d="M12 5v14M5 12h14"', '4: d="M9 5l7 7-7 7"']);
    // A registry read, a computed path, a label that happens to start with M, and a non-glyph
    // constant are all fine.
    expect(
      glyphHits(
        "probe.tsx",
        [
          'import { ICONS } from "@prismshadow/penguin-ui";',
          "const TRASH_ICON = ICONS.trash;",
          "export const Line = ({ d }: { d: string }) => <path d={d} />;",
          'const MENU_ICON = "Menu";',
          'const PATH = "M0 0h1";',
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
