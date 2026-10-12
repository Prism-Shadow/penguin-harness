/**
 * The RSI toolkits the Optimize tab offers: one per plugin of the library's `rsi` category.
 * Pinned to plugins/ by test/rsi-methods.test.ts, so a toolkit cannot ship without a row here.
 *
 * The default toolkit comes first: it is the select's first option, and its two Skills are the
 * ones the Use dialog has always preselected — the evaluator on the Evaluate tab, the optimizer
 * beside it on the Optimize tab. The toolkit ships only the optimizer; the evaluator it measures
 * through ships in the Agent Evaluation plugin, named by the row too. Every other toolkit is one plugin with one Skill named like it,
 * which initializes, measures and records on its own. Labels and blurbs live in the dictionaries,
 * under `S.benchmark.methods[id]`.
 */
export const RSI_METHODS = [
  {
    id: "default",
    plugin: "default-rsi-toolkit",
    skill: "agent-optimization",
    evaluationSkill: "agent-evaluation",
    evaluationPlugin: "agent-evaluation",
  },
  { id: "opro", plugin: "opro-rsi-toolkit", skill: "opro-rsi-toolkit" },
  { id: "ape", plugin: "ape-rsi-toolkit", skill: "ape-rsi-toolkit" },
  { id: "ace", plugin: "ace-rsi-toolkit", skill: "ace-rsi-toolkit" },
  { id: "awm", plugin: "awm-rsi-toolkit", skill: "awm-rsi-toolkit" },
] as const;

export type RsiMethod = (typeof RSI_METHODS)[number];
export type RsiMethodId = RsiMethod["id"];
export const DEFAULT_RSI_METHOD: RsiMethodId = "default";

/** The row of one method. */
export function rsiMethod(id: RsiMethodId): RsiMethod {
  return RSI_METHODS.find((m) => m.id === id) ?? RSI_METHODS[0];
}
