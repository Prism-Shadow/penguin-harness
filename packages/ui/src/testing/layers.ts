/**
 * The layer guard: every z-index names a layer of the scale in `layers.css`, which is the one
 * place a z-index is a number. Shared by the UI package's suite, which runs it over the package,
 * the Web App and the gallery.
 *
 * What it reads, and what it accepts:
 *
 * - **Classes** (the de-slop reader's class tokens: class attributes, class-shaped strings,
 *   `@apply` lists): a `z-*` utility must be `z-auto` or `z-<layer>`, with or without a variant or
 *   a minus; `z-10`, `z-[60]`, `z-(--x)` and an arbitrary `[z-index:…]` are raw.
 * - **Inline styles and style writes** in TypeScript: a `zIndex` property, an assignment to
 *   `.zIndex` and `setProperty("z-index", …)` must take `layer("<layer>")` (layers.ts).
 * - **Stylesheets**: a `z-index` declaration must be `auto` or `var(--layer-<layer>)`.
 * - **Names**: a layer named anywhere — `z-<layer>`, `layer("<layer>")`, `var(--layer-<layer>)` —
 *   must be one the scale declares, or it would silently paint at no layer at all.
 *
 * A file the allowlist names, with the reason it needs a raw value, is skipped whole.
 */
import ts from "typescript";
import { analyzeFile, matchesPolicyPath } from "./deslop";
import { parseCssRules } from "./css";
import type { SourceFile } from "./source-roots";

export interface LayerHit {
  /** Repo-relative id of the file. */
  readonly file: string;
  readonly line: number;
  /** What was found, as written. */
  readonly found: string;
  readonly problem: "raw" | "unknown layer";
}

/** The layers a scale file declares: the names of its `--layer-*` custom properties. */
export function declaredLayers(scaleCss: string): Set<string> {
  const names = new Set<string>();
  for (const rule of parseCssRules(scaleCss)) {
    for (const declaration of rule.declarations) {
      const match = /^--layer-([\w-]+)$/.exec(declaration.name);
      if (match !== null) names.add(match[1]!);
    }
  }
  return names;
}

const VAR_LAYER = /var\(\s*--layer-([\w-]+)\s*\)/g;

/** A `z-*` utility's verdict: null when it names a declared layer or is `z-auto`. */
function classProblem(utility: string, layers: ReadonlySet<string>): LayerHit["problem"] | null {
  if (/^\[z-index:/.test(utility)) return "raw";
  const match = /^-?z-(.+)$/.exec(utility);
  if (match === null) return null;
  const value = match[1]!;
  // `z-auto` resets; `z-index` is the property's own name in a string, not a utility.
  if (value === "auto" || value === "index") return null;
  if (/^[\d[(]/.test(value)) return "raw";
  return layers.has(value) ? null : "unknown layer";
}

/** `layer("<name>")`'s name, or null when the expression is anything else. */
function layerCall(node: ts.Expression): string | null {
  if (!ts.isCallExpression(node)) return null;
  if (!ts.isIdentifier(node.expression) || node.expression.text !== "layer") return null;
  const [arg] = node.arguments;
  return arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : null;
}

function markupHits(file: SourceFile, layers: ReadonlySet<string>): LayerHit[] {
  const hits: LayerHit[] = [];
  const source = ts.createSourceFile(
    file.path,
    file.text,
    ts.ScriptTarget.Latest,
    true,
    file.name.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lineAt = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const judge = (value: ts.Expression, at: ts.Node) => {
    const name = layerCall(value);
    if (name === null) {
      hits.push({ file: file.id, line: lineAt(at), found: at.getText(source), problem: "raw" });
    } else if (!layers.has(name)) {
      hits.push({
        file: file.id,
        line: lineAt(at),
        found: at.getText(source),
        problem: "unknown layer",
      });
    }
  };
  const keyIs = (name: ts.PropertyName, key: string) =>
    (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && name.text === key;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node) && keyIs(node.name, "zIndex")) {
      judge(node.initializer, node);
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      node.left.name.text === "zIndex"
    ) {
      judge(node.right, node);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "setProperty" &&
      node.arguments.length >= 2 &&
      ts.isStringLiteralLike(node.arguments[0]!) &&
      node.arguments[0].text === "z-index"
    ) {
      judge(node.arguments[1]!, node);
    } else if (ts.isStringLiteralLike(node)) {
      for (const match of node.text.matchAll(VAR_LAYER)) {
        if (!layers.has(match[1]!)) {
          hits.push({
            file: file.id,
            line: lineAt(node),
            found: match[0],
            problem: "unknown layer",
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function stylesheetHits(file: SourceFile, layers: ReadonlySet<string>): LayerHit[] {
  const hits: LayerHit[] = [];
  for (const rule of parseCssRules(file.text)) {
    for (const { name, value, line } of rule.declarations) {
      for (const match of value.matchAll(VAR_LAYER)) {
        if (!layers.has(match[1]!)) {
          hits.push({ file: file.id, line, found: match[0], problem: "unknown layer" });
        }
      }
      if (name !== "z-index") continue;
      if (value === "auto" || /^var\(\s*--layer-[\w-]+\s*\)$/.test(value)) continue;
      hits.push({ file: file.id, line, found: `z-index: ${value}`, problem: "raw" });
    }
  }
  return hits;
}

/**
 * Every z-index in `files` that is not a declared layer, by file and line. `allowlist` maps a
 * root-relative path (deslop's policy-path forms) to the reason that file keeps a raw value.
 */
export function layerHits(
  files: readonly SourceFile[],
  layers: ReadonlySet<string>,
  allowlist: Readonly<Record<string, string>> = {},
): LayerHit[] {
  const exempt = Object.keys(allowlist);
  const hits: LayerHit[] = [];
  for (const file of files) {
    if (matchesPolicyPath(file.rel, exempt)) continue;
    // Most files spell no layer at all; only the ones that might are parsed.
    if (!/z-|zIndex|--layer/.test(file.text)) continue;
    const analysis = analyzeFile(file);
    for (const token of analysis.tokens) {
      const problem = classProblem(token.utility, layers);
      if (problem !== null) {
        hits.push({ file: file.id, line: token.line, found: token.raw, problem });
      }
    }
    if (analysis.surface === "stylesheet") hits.push(...stylesheetHits(file, layers));
    else hits.push(...markupHits(file, layers));
  }
  return hits.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
}
