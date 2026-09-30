/**
 * One registry of line glyphs: `ICONS` in the shared UI package, and the app's manifests built on
 * it (`NAV_ICONS`, `STAT_ICONS`, the grouping and sort options).
 *
 * A path typed out in a feature file is how one bin came to be drawn five ways and a redraw came to
 * reach one surface and not the others. So new glyphs go into the registry, named for what they
 * draw, and a feature file reads them from there. What feature files still hold is listed below per
 * file, with the wave that moves or rebuilds the file. A near-copy of a registry glyph is not kept
 * beside it: the call site draws the registry's, so a bin or a pencil looks the same everywhere.
 * The counts are exact both ways, like the de-slop list: a new path fails as new, and one that goes
 * away fails until its entry shrinks, so the list only tightens.
 *
 * Two shapes are counted: a `const *_ICON` whose value is path data, and a literal `d="M…"` on an
 * element. A computed path (a chart's line, a sparkline, the topology view's edges) is not a
 * literal and is not read.
 */
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const SCAN = scanSources([".ts", ".tsx"]);
const WEB = SCAN.files.filter((file) => file.root === "web");

/** Glyph paths outside the registry, by path under `packages/web/src`: `[count, wave]`. */
const ALLOWLIST: Readonly<Record<string, readonly [number, string]>> = {
  "components/layout/app-layout.tsx": [3, "W7"],
  "components/layout/sidebar.tsx": [6, "W7"],
  "components/ui/info-popover.tsx": [1, "W3"],
  "features/chat/attached-files-banner.tsx": [1, "W6"],
  "features/chat/chat-input.tsx": [5, "W6"],
  "features/chat/conversation-outline.tsx": [1, "W6"],
  "features/chat/goal-use.ts": [1, "W6"],
  "features/chat/memory-view.tsx": [4, "W6"],
  "features/chat/message-item.tsx": [1, "W6"],
  "features/chat/message-stream.tsx": [1, "W6"],
  "features/chat/subagents-view.tsx": [1, "W6"],
  "features/chat/task-stats-line.tsx": [1, "W6"],
  "features/chat/workspace-browser.tsx": [1, "W7"],
  "features/company/channel-header.tsx": [4, "W6"],
  "features/company/channel-sidebar.tsx": [2, "W4"],
  "features/company/channel-view.tsx": [1, "W6"],
  "features/company/finance-page.tsx": [1, "W4"],
  "features/company/handbook-explorer.tsx": [1, "W4"],
  "features/company/shared.tsx": [2, "W4"],
  "features/dock/dock-panel.tsx": [1, "W7"],
  "features/models/models-page.tsx": [4, "W4"],
  "features/plugins/plugins-page.tsx": [2, "W4"],
  "features/schedules/schedule-panel.tsx": [3, "W4"],
  "features/schedules/schedule-suggestions.tsx": [3, "W4"],
  "features/semantic-id/semantic-id-field.tsx": [1, "W2"],
  "features/traces/trace-event-row.tsx": [1, "W4"],
};

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
  it("scans every source root", () => {
    expectEveryRootScanned(SCAN);
    expect(WEB.length).toBeGreaterThan(0);
  });

  it("are the listed ones, at the listed counts", () => {
    const found = new Map(
      WEB.map((file) => [file.rel, glyphHits(file.path, file.text)] as const).filter(
        ([, hits]) => hits.length > 0,
      ),
    );
    const problems: string[] = [];
    for (const rel of new Set([...found.keys(), ...Object.keys(ALLOWLIST)])) {
      const hits = found.get(rel) ?? [];
      const [allowed, wave] = ALLOWLIST[rel] ?? [0, ""];
      if (hits.length > allowed) {
        problems.push(
          `${rel}: ${hits.length} where ${allowed} are allowlisted — draw it from ICONS\n    ${hits.join("\n    ")}`,
        );
      } else if (hits.length < allowed) {
        problems.push(
          hits.length === 0
            ? `${rel}: none left of ${allowed} (${wave}) — delete the entry`
            : `${rel}: ${hits.length} left of ${allowed} — shrink the entry to [${hits.length}, "${wave}"]`,
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
