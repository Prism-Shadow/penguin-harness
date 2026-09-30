/**
 * A small CSS reader for tests: enough structure to find which rules declare which custom
 * properties, under which at-rules, at which line. Not a validator — it trusts the input to be CSS
 * that Tailwind and the browser already accept, and only has to see blocks, selectors and
 * declarations the way they do.
 */

export interface CssDeclaration {
  /** Property name as written, e.g. `--ui-canvas` or `color-scheme`. */
  readonly name: string;
  /** Value with surrounding whitespace trimmed and internal whitespace collapsed. */
  readonly value: string;
  /** 1-based line of the declaration's first character. */
  readonly line: number;
}

export interface CssStyleRule {
  /** The selector list as written, whitespace collapsed. */
  readonly selector: string;
  /** Enclosing at-rule preludes, outermost first, e.g. `["@layer ui-theme"]`. */
  readonly atRules: readonly string[];
  /** Selectors of enclosing style rules when CSS nesting is used, outermost first. */
  readonly parents: readonly string[];
  readonly declarations: readonly CssDeclaration[];
  /** 1-based line of the selector. */
  readonly line: number;
}

/** Replaces comments with spaces, keeping every newline so line numbers survive. */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

/** Every style rule in the sheet, nested ones included, in source order. */
export function parseCssRules(input: string): CssStyleRule[] {
  const css = stripCssComments(input);
  const lineStarts = [0];
  for (let at = css.indexOf("\n"); at !== -1; at = css.indexOf("\n", at + 1)) {
    lineStarts.push(at + 1);
  }
  const lineAt = (index: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid]! <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const rules: CssStyleRule[] = [];
  let i = 0;

  /** Consumes statements up to the matching `}` (or the end of input for the top level). */
  const block = (
    atRules: readonly string[],
    parents: readonly string[],
    selector: string | null,
    selectorLine: number,
  ): void => {
    const declarations: CssDeclaration[] = [];
    let start = i;
    let parens = 0;
    let quote: string | null = null;

    /** The text since `start`, and the index of its first non-whitespace character. */
    const pending = (end: number): { text: string; line: number } => {
      const text = css.slice(start, end);
      const lead = text.length - text.trimStart().length;
      return { text, line: lineAt(start + lead) };
    };

    const flushDeclaration = (end: number) => {
      const { text, line } = pending(end);
      // Outside a style rule this is an at-rule statement (`@layer a, b;`, `@import …;`): skipped.
      if (selector === null) return;
      const colon = text.indexOf(":");
      if (colon === -1 || collapse(text) === "") return;
      declarations.push({
        name: collapse(text.slice(0, colon)),
        value: collapse(text.slice(colon + 1)),
        line,
      });
    };

    while (i < css.length) {
      const ch = css[i]!;
      if (quote !== null) {
        if (ch === "\\") i++;
        else if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "(") {
        parens++;
      } else if (ch === ")") {
        parens--;
      } else if (parens === 0 && ch === ";") {
        flushDeclaration(i);
        start = i + 1;
      } else if (parens === 0 && ch === "{") {
        const { text, line } = pending(i);
        const prelude = collapse(text);
        i++;
        if (prelude.startsWith("@")) block([...atRules, prelude], parents, null, line);
        else block(atRules, selector === null ? parents : [...parents, selector], prelude, line);
        start = i;
        continue;
      } else if (parens === 0 && ch === "}") {
        flushDeclaration(i);
        i++;
        break;
      }
      i++;
    }
    if (selector !== null) {
      rules.push({ selector, atRules, parents, declarations, line: selectorLine });
    }
  };

  while (i < css.length) block([], [], null, 1);
  // A rule is recorded when its block closes, so a nesting parent lands after its children.
  return rules.sort((a, b) => a.line - b.line);
}

/** Splits a selector list on its top-level commas and normalizes each selector's spelling. */
export function selectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of selector) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts.map(normalizeSelector).filter((s) => s !== "");
}

/** Collapses whitespace and double-quotes attribute values: `[data-theme='x']` → `[data-theme="x"]`. */
export function normalizeSelector(selector: string): string {
  return collapse(selector)
    .replace(/\[\s*([\w-]+)\s*=\s*'([^']*)'\s*\]/g, '[$1="$2"]')
    .replace(/\[\s*([\w-]+)\s*=\s*([\w-]+)\s*\]/g, '[$1="$2"]')
    .replace(/\[\s*([\w-]+)\s*=\s*"([^"]*)"\s*\]/g, '[$1="$2"]');
}
