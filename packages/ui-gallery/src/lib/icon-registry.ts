/**
 * Reads the Web App's line-icon path strings out of its source text, for the Icons foundation page.
 *
 * Until W1 moves the icons into one registry in `packages/ui`, the paths are spread over a few web
 * modules, several re-export each other, and some are template literals built from shared
 * fragments. The gallery must not import web modules (they pull in the app's strings and state),
 * so it takes their raw text (`?raw`) and extracts:
 *
 *   export const TRASH_ICON = "M4 6h16…";                  → TRASH_ICON
 *   export const HIDDEN_ICON = `${EYE_OUTLINE}M3 3l18 18`;  → HIDDEN_ICON (fragment resolved)
 *   export const NAV_ICONS = { usage: "M4 20V10…", agents: AGENT_GROUP_ICON };
 *                                                          → NAV_ICONS.usage, NAV_ICONS.agents
 *
 * Constants resolve across every given file. Only strings that are SVG path data survive, and
 * entries sharing one path are merged, so the page shows each distinct glyph once with every name
 * it goes by — duplicates become visible instead of silently multiplying.
 */

export interface IconEntry {
  /** The path data. */
  d: string;
  /** Every name the path is declared under, in first-seen order. */
  names: string[];
  /** The files that declare it, in first-seen order. */
  sources: string[];
}

/** SVG path data: a moveto, then only path commands, numbers and separators. */
const PATH_DATA = /^[Mm][\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]*$/;

type Expr = { kind: "literal"; text: string } | { kind: "ref"; name: string };

interface Declaration {
  name: string;
  expr: Expr;
  source: string;
}

const STRING = String.raw`"((?:[^"\\\n]|\\.)*)"|'((?:[^'\\\n]|\\.)*)'|\x60([^\x60\\]*)\x60`;
const REF = String.raw`([A-Z][A-Z0-9_]*(?:\.[A-Za-z_$][\w$]*)?)`;
const VALUE = String.raw`(?:${STRING}|${REF})`;

const CONST_DECL = new RegExp(
  String.raw`\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;]*)?=\s*(?:${VALUE})\s*(?:as\s+const\s*)?[;\n]`,
  "g",
);
const OBJECT_DECL = new RegExp(String.raw`\bconst\s+([A-Z][A-Z0-9_]*)\s*(?::[^=;]*)?=\s*\{`, "g");
const ENTRY = new RegExp(
  String.raw`(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*:\s*(?:${VALUE})\s*(?=[,}\n]|$)`,
  "g",
);

function exprOf(match: RegExpExecArray, offset: number): Expr | null {
  const [dq, sq, tpl, ref] = [
    match[offset],
    match[offset + 1],
    match[offset + 2],
    match[offset + 3],
  ];
  if (dq !== undefined) return { kind: "literal", text: dq };
  if (sq !== undefined) return { kind: "literal", text: sq };
  if (tpl !== undefined) return { kind: "literal", text: tpl };
  if (ref !== undefined) return { kind: "ref", name: ref };
  return null;
}

/** The body between the `{` at `open` and its matching `}`, skipping braces inside strings. */
function objectBody(text: string, open: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return "";
}

/** Block and line comments out, strings kept intact (a path never contains `//`, a URL might). */
function stripComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote !== null) {
      out += ch;
      if (ch === "\\") out += text[++i] ?? "";
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end === -1 ? text.length : end - 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    out += ch;
  }
  return out;
}

function declarations(source: string, raw: string): Declaration[] {
  const text = stripComments(raw);
  const found: Declaration[] = [];
  for (const m of text.matchAll(CONST_DECL)) {
    const expr = exprOf(m, 2);
    if (m[1] && expr) found.push({ name: m[1], expr, source });
  }
  for (const m of text.matchAll(OBJECT_DECL)) {
    if (!m[1]) continue;
    const body = objectBody(text, (m.index ?? 0) + m[0].length - 1);
    for (const e of body.matchAll(ENTRY)) {
      const expr = exprOf(e, 2);
      if (e[1] && expr) found.push({ name: `${m[1]}.${e[1]}`, expr, source });
    }
  }
  return found;
}

export function extractIconPaths(sources: Readonly<Record<string, string>>): IconEntry[] {
  const all = Object.entries(sources).flatMap(([source, text]) => declarations(source, text));
  const table = new Map<string, Declaration>();
  for (const decl of all) if (!table.has(decl.name)) table.set(decl.name, decl);

  const resolving = new Set<string>();
  const resolve = (expr: Expr): string | null => {
    if (expr.kind === "ref") {
      const target = table.get(expr.name);
      if (!target || resolving.has(expr.name)) return null;
      resolving.add(expr.name);
      const value = resolve(target.expr);
      resolving.delete(expr.name);
      return value;
    }
    let failed = false;
    const text = expr.text.replace(
      /\$\{\s*([A-Z][A-Z0-9_]*(?:\.[A-Za-z_$][\w$]*)?)\s*\}/g,
      (_, name: string) => {
        const value = resolve({ kind: "ref", name });
        if (value === null) failed = true;
        return value ?? "";
      },
    );
    return failed ? null : text;
  };

  const byPath = new Map<string, IconEntry>();
  for (const decl of all) {
    const d = resolve(decl.expr)?.trim();
    if (!d || !PATH_DATA.test(d)) continue;
    const entry = byPath.get(d);
    if (!entry) byPath.set(d, { d, names: [decl.name], sources: [decl.source] });
    else {
      if (!entry.names.includes(decl.name)) entry.names.push(decl.name);
      if (!entry.sources.includes(decl.source)) entry.sources.push(decl.source);
    }
  }
  return [...byPath.values()];
}

/** `ICON_SIZE = { rowMark: 12, … }` → its rungs, from `lib/icon-scale.ts`'s text. */
export function extractIconSizes(raw: string): { name: string; px: number }[] {
  const text = stripComments(raw);
  const decl = /\bconst\s+ICON_SIZE\s*(?::[^=;]*)?=\s*\{/.exec(text);
  if (!decl) return [];
  const body = objectBody(text, decl.index + decl[0].length - 1);
  return [...body.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\d+(?:\.\d+)?)/g)].map((m) => ({
    name: m[1] ?? "",
    px: Number(m[2]),
  }));
}
