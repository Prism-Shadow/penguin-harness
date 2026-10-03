/**
 * The human-readable report the checker prints: block summary, issues grouped by bucket with
 * block, line and path, the four scores against the gate, and optionally the rubric. Kept out of
 * cli.ts so a hook or a UI can print the same text without Node.
 */
import { A2UI_RUBRIC } from "./rubric.js";
import { A2UI_SCORING, type A2uiIssue, type A2uiReport } from "./types.js";

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function where(issue: A2uiIssue): string {
  const parts: string[] = [];
  if (issue.block !== undefined) parts.push(`block ${issue.block}`);
  if (issue.line !== undefined) parts.push(`line ${issue.line}`);
  if (issue.path !== undefined) parts.push(issue.path);
  return parts.length > 0 ? `[${parts.join(" ")}] ` : "";
}

export function formatReport(report: A2uiReport, opts: { rubric?: boolean } = {}): string {
  const errors = report.issues.filter((issue) => issue.level === "error");
  const l2 = report.issues.filter((issue) => issue.level === "warning" && issue.scope !== "prose");
  const prose = report.issues.filter((issue) => issue.scope === "prose");
  const out: string[] = [
    `a2ui check: ${plural(report.blocks.length, "block")}, ${plural(errors.length, "error")}, ${plural(l2.length + prose.length, "warning")} (lang ${report.lang})`,
  ];
  for (const block of report.blocks) {
    out.push(
      `  block ${block.index}: ${block.fence}${block.type !== undefined ? ` ${block.type}` : ""} — ${block.ok ? "ok" : "ERROR"}`,
    );
  }
  if (report.blocks.length === 0) out.push("  no a2ui or mermaid blocks; prose rules only");
  const section = (title: string, list: A2uiIssue[]): void => {
    if (list.length === 0) return;
    out.push("", title);
    for (const issue of list) out.push(`  ${where(issue)}${issue.code}: ${issue.message}`);
  };
  section("errors (fix before sending):", errors);
  section("warnings — blocks (L2):", l2);
  section("warnings — prose (STE):", prose);
  const s = report.score;
  const verdict =
    errors.length > 0
      ? "total is 0 while any error remains"
      : s.total < A2UI_SCORING.passTotal
        ? `below the ${A2UI_SCORING.passTotal} gate; fix the warnings that matter`
        : "pass";
  out.push("", `score: L1 ${s.l1}  L2 ${s.l2}  prose ${s.prose}  total ${s.total}  (${verdict})`);
  if (opts.rubric) {
    out.push("", "self-review before sending:");
    A2UI_RUBRIC[report.lang].forEach((question, i) => out.push(`  ${i + 1}. ${question}`));
  }
  return out.join("\n");
}
