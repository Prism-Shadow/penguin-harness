/**
 * L1 checks on a ```mermaid body without a Mermaid parser: a supported diagram header, no
 * configuration or link syntax from the model, and a best-effort balance check that catches the
 * usual breakage (an unquoted parenthesis in a node label). The real parse happens in the
 * browser; these rules exist so the model hears about the common mistakes before it sends, and
 * so the renderer can refuse what the sanitiser would not.
 *
 * Why directives and frontmatter are errors even under `securityLevel: "strict"`: Mermaid only
 * protects the keys on its `secure` list (securityLevel, startOnLoad, maxTextSize, …); a
 * `%%{init: {"themeCSS": …}}%%` directive or a frontmatter `config:` block still injects CSS
 * into the rendered SVG. The app sets the theme; the model names a diagram.
 */
import { A2UI_LIMITS, type A2uiIssue } from "./types.js";
import { splitLines } from "./fences.js";

/** Diagram headers the renderer accepts (first non-comment line, first word). */
export const MERMAID_TYPES = [
  "flowchart",
  "graph",
  "sequenceDiagram",
  "stateDiagram",
  "stateDiagram-v2",
  "classDiagram",
  "erDiagram",
  "gantt",
  "journey",
  "pie",
  "mindmap",
  "timeline",
  "gitGraph",
  "quadrantChart",
  "xychart-beta",
  "requirementDiagram",
  "C4Context",
] as const;

const MERMAID_TYPE_SET: ReadonlySet<string> = new Set(MERMAID_TYPES);

/** Types whose statements carry bracketed node shapes, so an unbalanced bracket is a parse error. */
const BRACKET_CHECKED: ReadonlySet<string> = new Set([
  "flowchart",
  "graph",
  "stateDiagram",
  "stateDiagram-v2",
  "classDiagram",
  "erDiagram",
]);
/** Braces close on the same line (diamond shapes); elsewhere they open multi-line bodies. */
const BRACES_PER_LINE: ReadonlySet<string> = new Set(["flowchart", "graph"]);
/** Types whose braces span lines (`class X {`, `state X {`); erDiagram's `o{` cardinality marks make its braces uncountable. */
const BRACES_PER_DOCUMENT: ReadonlySet<string> = new Set([
  "classDiagram",
  "stateDiagram",
  "stateDiagram-v2",
]);

const FORBIDDEN: ReadonlyArray<{ re: RegExp; what: string }> = [
  { re: /^click\s/i, what: "a click binding" },
  { re: /^link\s+\S+\s+"/, what: "a link binding" },
  { re: /^callback\s/i, what: "a callback binding" },
  { re: /\bhref\s*[="]/i, what: "an href" },
  { re: /javascript:/i, what: "a javascript: URL" },
  { re: /<script/i, what: "a script tag" },
];

/** Lines that structure a diagram without adding a node or an edge. */
const NOT_A_STATEMENT =
  /^(end|subgraph\b|style\b|classDef\b|linkStyle\b|direction\b|title\b|dateFormat\b|axisFormat\b|section\b|x-axis\b|y-axis\b|accTitle\b|accDescr\b)/;

const issue = (
  level: A2uiIssue["level"],
  code: string,
  message: string,
  line?: number,
): A2uiIssue => {
  const out: A2uiIssue = { level, code, message };
  if (line !== undefined) out.line = line;
  return out;
};

/** The text outside double quotes, and how many quote characters the line had. */
function unquoted(line: string): { text: string; quotes: number } {
  let text = "";
  let inside = false;
  let quotes = 0;
  for (const ch of line) {
    if (ch === '"') {
      quotes++;
      inside = !inside;
      continue;
    }
    if (!inside) text += ch;
  }
  return { text, quotes };
}

const count = (text: string, ch: string): number => text.split(ch).length - 1;

function checkLineBalance(
  line: string,
  n: number,
  braces: boolean,
  issues: A2uiIssue[],
): { text: string } {
  const { text, quotes } = unquoted(line);
  if (quotes % 2 === 1) {
    issues.push(
      issue(
        "error",
        "mermaid_unbalanced",
        `Line ${n} has an odd number of double quotes; close the quoted label.`,
        n,
      ),
    );
    return { text };
  }
  const pairs: Array<[string, string]> = [
    ["(", ")"],
    ["[", "]"],
  ];
  if (braces) pairs.push(["{", "}"]);
  for (const [open, close] of pairs) {
    const opens = count(text, open);
    const closes = count(text, close);
    if (opens === closes) continue;
    // The asymmetric shape `A>text]` closes a `>` with a `]`.
    if (close === "]" && closes - opens === 1 && text.includes(">")) continue;
    issues.push(
      issue(
        "error",
        "mermaid_unbalanced",
        `Line ${n} has ${opens} "${open}" and ${closes} "${close}"; a label with brackets must be quoted, e.g. A["text (detail)"].`,
        n,
      ),
    );
  }
  return { text };
}

/** L1 checks of one ```mermaid body; the issues' `line` is 1-based within the body. */
export function checkMermaid(source: string): A2uiIssue[] {
  const issues: A2uiIssue[] = [];
  const lines = splitLines(source);
  const firstIdx = lines.findIndex((line) => line.trim() !== "");
  if (firstIdx === -1) {
    issues.push(issue("error", "mermaid_empty", "The mermaid fence is empty; write a diagram."));
    return issues;
  }
  let start = 0;
  if ((lines[firstIdx] ?? "").trim() === "---") {
    const close = lines.findIndex((line, i) => i > firstIdx && line.trim() === "---");
    if (close === -1) {
      issues.push(
        issue(
          "error",
          "mermaid_unbalanced",
          "The frontmatter opened with --- is never closed; add the closing --- or drop it.",
          firstIdx + 1,
        ),
      );
      return issues;
    }
    for (let i = firstIdx + 1; i < close; i++) {
      const m = /^\s*([A-Za-z_][\w-]*)\s*:/.exec(lines[i] ?? "");
      if (m && m[1] !== "title") {
        issues.push(
          issue(
            "error",
            "mermaid_directive",
            `Frontmatter key \`${m[1]}\` is not allowed (only \`title\`); the app configures the diagram, not the model.`,
            i + 1,
          ),
        );
      }
    }
    start = close + 1;
  }

  let header: string | undefined;
  let statements = 0;
  let braceBalance = 0;
  for (let i = start; i < lines.length; i++) {
    const n = i + 1;
    const line = (lines[i] ?? "").trim();
    if (line === "") continue;
    if (line.includes("%%{")) {
      issues.push(
        issue(
          "error",
          "mermaid_directive",
          `Line ${n} carries an init directive (%%{ … }%%); remove it — the app sets the theme.`,
          n,
        ),
      );
      continue;
    }
    if (line.startsWith("%%")) continue;
    if (header === undefined) {
      header = /^([A-Za-z][\w-]*)/.exec(line)?.[1] ?? line;
      if (!MERMAID_TYPE_SET.has(header)) {
        issues.push(
          issue(
            "error",
            "mermaid_unknown_type",
            `"${header}" is not a supported diagram; start with one of ${MERMAID_TYPES.join(", ")}.`,
            n,
          ),
        );
      }
      continue;
    }
    for (const rule of FORBIDDEN) {
      if (rule.re.test(line)) {
        issues.push(
          issue(
            "error",
            "mermaid_forbidden",
            `Line ${n} carries ${rule.what}; links, clicks and scripts are not rendered — describe the target in the prose instead.`,
            n,
          ),
        );
        break;
      }
    }
    if (!NOT_A_STATEMENT.test(line)) statements++;
    if (BRACKET_CHECKED.has(header)) {
      const { text } = checkLineBalance(line, n, BRACES_PER_LINE.has(header), issues);
      if (BRACES_PER_DOCUMENT.has(header)) braceBalance += count(text, "{") - count(text, "}");
    }
  }
  if (header === undefined) {
    issues.push(
      issue("error", "mermaid_empty", "The mermaid fence has no diagram header; write one."),
    );
    return issues;
  }
  if (braceBalance !== 0) {
    issues.push(
      issue(
        "error",
        "mermaid_unbalanced",
        `The diagram opens ${braceBalance > 0 ? braceBalance + " more { than }" : -braceBalance + " more } than {"}; close every block.`,
        lines.length,
      ),
    );
  }
  if (statements > A2UI_LIMITS.mermaid.statements || lines.length > A2UI_LIMITS.mermaid.lines) {
    issues.push(
      issue(
        "warning",
        "mermaid_too_big",
        `The diagram has ${statements} statements over ${lines.length} lines; more than ${A2UI_LIMITS.mermaid.statements} nodes or edges is hard to read — split it or show only the main path.`,
      ),
    );
  }
  return issues;
}
