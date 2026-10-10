/**
 * The RSI toolkits the Optimize tab offers: one per plugin of the library's `rsi` category.
 * Pinned to plugins/ by test/rsi-methods.test.ts, so a toolkit cannot ship without a row here.
 *
 * The default toolkit comes first: it is the select's first option, and its two Skills are the
 * ones the Use dialog has always preselected — the evaluator on the Evaluate tab, the optimizer
 * beside it on the Optimize tab. Every other toolkit is one plugin with one Skill named like it,
 * which initializes, measures and records on its own. Labels and blurbs live in the dictionaries,
 * under `S.benchmark.methods[id]`.
 */
export const RSI_METHODS = [
  {
    id: "default",
    plugin: "rsi-default",
    skill: "agent-optimization",
    evaluationSkill: "agent-evaluation",
  },
  { id: "opro", plugin: "rsi-opro", skill: "rsi-opro" },
  { id: "ape", plugin: "rsi-ape", skill: "rsi-ape" },
  { id: "ace", plugin: "rsi-ace", skill: "rsi-ace" },
  { id: "awm", plugin: "rsi-awm", skill: "rsi-awm" },
] as const;

export type RsiMethod = (typeof RSI_METHODS)[number];
export type RsiMethodId = RsiMethod["id"];
export const DEFAULT_RSI_METHOD: RsiMethodId = "default";

/** The row of one method. */
export function rsiMethod(id: RsiMethodId): RsiMethod {
  return RSI_METHODS.find((m) => m.id === id) ?? RSI_METHODS[0];
}
