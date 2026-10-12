/**
 * The whole-reply check the skill's script runs: L1 per block (parseA2ui / checkMermaid), the L2
 * heuristics across blocks (too many blocks, a question that does not end the turn, a block no
 * sentence introduces, a snapshot that does not say when it was taken), the prose lint, and one
 * score. The L3 questions — would text have done, is this what a person would say — are not
 * detectable and live in A2UI_RUBRIC instead.
 */
import { parseA2ui } from "./catalog.js";
import { blocksFromFences, fenceLineSet, scanFences, splitLines } from "./fences.js";
import { checkMermaid } from "./mermaid.js";
import { lintProse, resolveLang } from "./prose.js";
import {
  A2UI_SCORING,
  type A2uiIssue,
  type A2uiLangOption,
  type A2uiReport,
  type A2uiSpec,
} from "./types.js";

const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const TABLE_ROW = /^\s*\|/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

/** Checks a reply: L1 per block, L2 across blocks, the prose lint, and the score. */
export function checkReply(markdown: string, opts: { lang?: A2uiLangOption } = {}): A2uiReport {
  const lang = resolveLang(markdown, opts.lang);
  const lines = splitLines(markdown);
  const spans = scanFences(markdown);
  const blocks = blocksFromFences(spans);
  const fenced = fenceLineSet(spans);
  const issues: A2uiIssue[] = [];
  const summary: A2uiReport["blocks"] = [];
  const typeOf = new Map<number, string | undefined>();
  const specOf = new Map<number, A2uiSpec>();

  for (const block of blocks) {
    const own: A2uiIssue[] = [];
    let type: string | undefined;
    if (!block.closed) {
      own.push({
        level: "error",
        code: "unclosed_fence",
        message: `The ${block.fence} fence opened on line ${block.startLine} is never closed; add the closing fence line.`,
        line: block.startLine,
      });
    }
    let relative: A2uiIssue[];
    if (block.fence === "a2ui") {
      const result = parseA2ui(block.source);
      type = result.spec?.type ?? result.type;
      relative = result.issues;
      if (result.spec !== undefined) specOf.set(block.index, result.spec);
    } else {
      relative = checkMermaid(block.source);
    }
    for (const issue of relative) {
      // Lines inside a fence body count from the line after the opening fence.
      own.push(issue.line !== undefined ? { ...issue, line: block.startLine + issue.line } : issue);
    }
    for (const issue of own) {
      issues.push({ ...issue, block: block.index, scope: issue.level === "error" ? "l1" : "l2" });
    }
    const entry: A2uiReport["blocks"][number] = {
      index: block.index,
      fence: block.fence,
      ok: own.every((issue) => issue.level !== "error"),
    };
    if (type !== undefined) entry.type = type;
    summary.push(entry);
    typeOf.set(block.index, type);
  }

  const l2 = (code: string, message: string, block?: number, line?: number): void => {
    const issue: A2uiIssue = { level: "warning", code, message, scope: "l2" };
    if (block !== undefined) issue.block = block;
    if (line !== undefined) issue.line = line;
    issues.push(issue);
  };
  const label = (index: number, fence: string): string =>
    fence === "mermaid" ? "mermaid" : (typeOf.get(index) ?? "a2ui");

  // Only a question ends the turn; the widgets are read-only and prose may follow them.
  const interactive = blocks.filter((b) => {
    const t = typeOf.get(b.index);
    return b.fence === "a2ui" && (t === "choice" || t === "form");
  });
  if (interactive.length > 2 || blocks.length > 4) {
    l2(
      "ui_overuse",
      `${blocks.length} blocks (${interactive.length} interactive) in one reply; keep to one or two blocks and at most two questions, or answer in prose.`,
    );
  }
  for (const b of interactive) {
    if (lines.slice(b.endLine).some((line) => line.trim() !== "")) {
      l2(
        "interactive_not_last",
        `Content follows the ${label(b.index, b.fence)} block that ends on line ${b.endLine}; a question ends the turn — move the block to the end, or drop what follows.`,
        b.index,
        b.endLine,
      );
    }
  }
  for (const b of blocks) {
    const spec = specOf.get(b.index);
    if (spec === undefined) continue;
    if ((spec.type === "weather" || spec.type === "metrics") && spec.asOf === undefined) {
      l2(
        "no_as_of",
        `The ${spec.type} block on line ${b.startLine} has no \`asOf\`; a snapshot says when it was taken — add the time the data was read (a script prints it).`,
        b.index,
        b.startLine,
      );
    }
  }
  for (const b of blocks) {
    let i = b.startLine - 2;
    while (i >= 0 && (lines[i] ?? "").trim() === "") i--;
    const above = i >= 0 ? (lines[i] ?? "") : "";
    const grounded =
      i >= 0 &&
      !fenced.has(i + 1) &&
      !HEADING.test(above) &&
      !TABLE_ROW.test(above) &&
      !THEMATIC_BREAK.test(above) &&
      !above.trimStart().startsWith("<!--");
    if (!grounded) {
      l2(
        "ungrounded_block",
        `The ${label(b.index, b.fence)} block on line ${b.startLine} is not introduced; write one sentence before it that says what it is for.`,
        b.index,
        b.startLine,
      );
    }
  }

  for (const issue of lintProse(markdown, { lang })) issues.push({ ...issue, scope: "prose" });

  const errors = issues.filter((issue) => issue.level === "error").length;
  const l2Warnings = issues.filter(
    (issue) => issue.level === "warning" && issue.scope === "l2",
  ).length;
  const proseWarnings = issues.filter((issue) => issue.scope === "prose").length;
  const l1Score = errors === 0 ? 100 : 0;
  const l2Score = Math.max(0, 100 - A2UI_SCORING.l2PerWarning * l2Warnings);
  const proseScore = Math.max(0, 100 - A2UI_SCORING.prosePerWarning * proseWarnings);
  const total =
    errors > 0
      ? 0
      : Math.round(A2UI_SCORING.l2Weight * l2Score + A2UI_SCORING.proseWeight * proseScore);
  return {
    ok: errors === 0,
    blocks: summary,
    issues,
    score: { l1: l1Score, l2: l2Score, prose: proseScore, total },
    lang,
  };
}
