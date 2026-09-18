/**
 * A semantic id for a display name, whatever kind of object the create dialog names: the one
 * proposal every `suggest-id` answer comes from. The Project's default model translates the
 * name into one English identifier in the kind's spelling — the common case is a Chinese name,
 * which nothing mechanical can transliterate — and the ASCII slug of the name answers whenever
 * the model is unavailable, refuses or answers with something no id can be built from. A name
 * that neither path can name gets a dated placeholder and the reason it fell that far: the
 * dialog fills the box and asks for a meaningful name in its place, which is a better answer
 * than a refusal that leaves the box empty and the user with nothing to type.
 *
 * The caller decides what surrounds the proposal and passes it in: the kind's rule (a
 * non-admin's Project rule depends on who asks), the ids to avoid, where a dead end is
 * recorded. The completion itself belongs to no Session and is not metered.
 */
import type {
  SemanticIdKind,
  SemanticIdSuggestReason,
  SemanticIdSuggestResponse,
} from "../api/types.js";
import type { UtilityCompletion } from "./project-config-service.js";
import { fallbackSemanticId, placeholderSemanticId, sanitizeSuggestedId } from "./semantic-id.js";
import type { SemanticIdRule } from "./semantic-id.js";

export interface SemanticIdSuggestDeps {
  /** One short completion on the Project's default model; absent when nothing can be asked at all. */
  completeOnce?: ((projectId: string, prompt: string) => Promise<UtilityCompletion>) | undefined;
  /** Records one dead end of the model half (already truncated), for the log and the errors panel. */
  recordFailure: (projectId: string, detail: string) => void;
}

export interface SemanticIdSuggestInput {
  /** The display name (or whatever else names the thing yet). */
  name: string;
  /** For the failure record: which kind of id was asked for. */
  kind: SemanticIdKind;
  rule: SemanticIdRule;
  /** Ids to avoid that the prompt also names: the few a dialog passed in. */
  taken: readonly string[];
  /**
   * Ids to avoid that the prompt does not name: the server's own view of what exists, which
   * may be long and is not the model's business (every Project id on the server, say).
   */
  reserved?: Iterable<string>;
}

/**
 * Appended to the prompt on the one retry an unusable answer buys. The first ask already
 * describes the format; a model that answered with prose anyway is told, in one sentence, that
 * the answer IS the identifier — which is the instruction such a model complies with.
 */
const SEMANTIC_ID_RETRY_RULE = {
  _: "Answer with the identifier only — ASCII lowercase letters, digits and underscores, nothing else.",
  "-": "Answer with the identifier only — ASCII lowercase letters, digits and hyphens, nothing else.",
} as const;

/** How much of a failed proposal's detail reaches the log and the errors panel. */
const ID_SUGGEST_FAILURE_MAX = 300;

export async function suggestSemanticId(
  deps: SemanticIdSuggestDeps,
  projectId: string,
  input: SemanticIdSuggestInput,
): Promise<SemanticIdSuggestResponse> {
  const avoid = [...input.taken, ...(input.reserved ?? [])];
  // No model bound at all: nothing more specific can be said than what the name itself lacks.
  let reason: SemanticIdSuggestReason = "no_ascii";
  if (deps.completeOnce !== undefined) {
    const proposed = await modelSemanticId(deps, deps.completeOnce, projectId, input, avoid);
    if (proposed.id !== undefined) return { id: proposed.id, source: "model" };
    reason = proposed.reason;
  }
  const id = fallbackSemanticId(input.name, input.rule, avoid);
  if (id !== null) return { id, source: "fallback" };
  return { id: placeholderSemanticId(input.rule, avoid), source: "placeholder", reason };
}

/**
 * The model half of a proposal: the id it produced, or the reason there is none. An answer
 * that does not sanitize to an id buys one retry with the format rule spelled out — a model
 * that explained itself the first time usually complies when told to answer with the
 * identifier alone — while a request that failed outright is not repeated, since nothing
 * about the second ask would go differently. Every dead end is recorded, so the errors panel
 * can say why the button produced a placeholder instead of a name.
 */
async function modelSemanticId(
  deps: SemanticIdSuggestDeps,
  complete: NonNullable<SemanticIdSuggestDeps["completeOnce"]>,
  projectId: string,
  input: SemanticIdSuggestInput,
  avoid: readonly string[],
): Promise<
  { id: string; reason?: undefined } | { id?: undefined; reason: SemanticIdSuggestReason }
> {
  const record = (detail: string) =>
    deps.recordFailure(
      projectId,
      `${input.kind} id for "${input.name}": ${detail}`.slice(0, ID_SUGGEST_FAILURE_MAX),
    );
  const base = semanticIdPrompt(input);
  let lastAnswer = "";
  for (const prompt of [base, `${base} ${SEMANTIC_ID_RETRY_RULE[input.rule.separator]}`]) {
    const res = await complete(projectId, prompt);
    if (!res.ok) {
      record(res.error);
      return { reason: res.cause === "no_model" ? "no_default_model" : "model_failed" };
    }
    const id = sanitizeSuggestedId(res.text, input.rule, avoid);
    if (id !== null) return { id };
    lastAnswer = res.text;
  }
  record(`no id could be built from the model's answer: ${lastAnswer.trim()}`);
  return { reason: "unusable_answer" };
}

/**
 * The ask: one identifier in the kind's spelling, made of English words, with the kind's own
 * examples. A kind whose ids carry a prefix tells the model not to add one; the ids a dialog
 * passed in are named so the model can pick different words rather than collect a `_2`.
 */
function semanticIdPrompt(input: SemanticIdSuggestInput): string {
  const { rule } = input;
  const taken = input.taken.join(", ");
  const format =
    rule.separator === "_"
      ? [
          "You produce identifiers. Given a display name, answer with ONE snake_case ASCII identifier:",
          "lowercase letters, digits and underscores, starting with a letter, 2–40 characters, made of",
        ]
      : [
          "You produce identifiers. Given a display name, answer with ONE kebab-case ASCII identifier:",
          "lowercase letters, digits and hyphens, 2–40 characters, made of",
        ];
  return [
    ...format,
    "English words that carry the name's meaning (translate a non-English name), no explanation,",
    `nothing else. Examples: ${rule.examples}`,
    ...(rule.prefix !== ""
      ? ["Do not add any prefix of your own; one is added to your answer."]
      : []),
    ...(taken !== ""
      ? [`Those answers are taken${rule.prefix !== "" ? ", prefix included" : ""}: ${taken}.`]
      : []),
    `Name: ${input.name}`,
  ].join(" ");
}
