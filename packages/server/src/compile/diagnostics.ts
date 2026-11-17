import { describeProblem, ModuleBootError } from "@prismshadow/penguin-core/kernel";
import type { ModuleEdit, OperatorOrigin, Problem } from "@prismshadow/penguin-core/kernel";

export interface CompileDiagnostic {
  problem: Problem;
  origins: OperatorOrigin[];
}

/** Relevant edit witnesses, including tombstones. This is not minimal causal blame. */
export function diagnosticFor(problem: Problem, edits: readonly ModuleEdit[]): CompileDiagnostic {
  const names = new Set([problem.path.split("/").filter(Boolean).at(-1)!]);
  if ("from" in problem && problem.from) names.add(problem.from);
  if ("other" in problem) names.add(problem.other.split("/").filter(Boolean).at(-1)!);
  const relevant = edits.filter(
    (edit) =>
      names.has(edit.module) || (problem.kind === "unresolved" && !problem.from && edit.removed),
  );
  const origins = [
    ...new Map(
      relevant.map(({ origin }) => [
        `${origin.pass}:${origin.index}:${origin.plugin ?? ""}`,
        origin,
      ]),
    ).values(),
  ];
  return { problem, origins };
}

export class ModuleCompileError extends ModuleBootError {
  constructor(readonly diagnostics: readonly CompileDiagnostic[]) {
    super(
      `module tree rejected at compile:\n${diagnostics
        .map(({ problem, origins }) => {
          const source = origins
            .map(
              (o) =>
                `${o.pass}/${o.operator}#${o.index}${o.plugin ? ` (${o.plugin})` : ""}${o.source ? ` at ${o.source}` : ""}`,
            )
            .join(", ");
          return `  - ${describeProblem(problem)}${source ? `\n    related operators: ${source}` : ""}`;
        })
        .join("\n")}`,
      diagnostics.map(({ problem }) => problem),
    );
  }
}
