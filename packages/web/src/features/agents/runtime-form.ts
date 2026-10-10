/**
 * The Runtime tab's form (agent-settings-page.tsx) as pure functions: the draft a loaded config
 * opens with, the value a Save would send (what dirtiness compares), the errors a draft carries,
 * and the update a Save sends.
 *
 * The five numbers are typed as text, so a box can be cleared and retyped. A box's value is the
 * number it holds, `undefined` when it is blank, or its text when that is not a number at all —
 * which differs from every stored value, so an unparsable box is dirty (and invalid) rather than
 * slipping past the leave guard as "no change".
 *
 * The server takes each number as an integer that is > 0 or exactly -1, and it cannot drop a
 * stored override: blanking a box that holds a saved value is therefore an error, not a request
 * to go back to the default.
 */
import type {
  AgentCompactionConfigDto,
  AgentConfigDto,
  AgentConfigUpdateRequest,
  AgentModelConfigDto,
} from "@prismshadow/penguin-server/api";

/** The five number boxes, in the order the tab shows them. */
export const RUNTIME_NUMBER_FIELDS = [
  "maxTurns",
  "maxTokens",
  "timeoutMs",
  "maxContextLength",
  "maxSessionTurns",
] as const;

export type RuntimeNumberField = (typeof RUNTIME_NUMBER_FIELDS)[number];

/** The Runtime tab's draft: the numbers as typed, the two menus' picks ("" = not set), the prompt. */
export type RuntimeDraft = Record<RuntimeNumberField, string> & {
  thinkingLevel: string;
  mode: string;
  prompt: string;
};

/** Why a number box cannot be saved: not an integer > 0 or -1, or a saved value left blank. */
export type RuntimeNumberError = "invalid" | "cannotClear";

const text = (n: number | undefined): string => (n === undefined ? "" : String(n));

/** The draft a loaded config opens with. */
export function runtimeDraftOf(config: AgentConfigDto): RuntimeDraft {
  return {
    maxTurns: text(config.maxTurns),
    maxTokens: text(config.model?.maxTokens),
    timeoutMs: text(config.model?.timeoutMs),
    maxContextLength: text(config.compaction?.maxContextLength),
    maxSessionTurns: text(config.compaction?.maxSessionTurns),
    thinkingLevel: config.model?.thinkingLevel ?? "",
    mode: config.compaction?.mode ?? "",
    prompt: config.compaction?.prompt ?? "",
  };
}

/** A number box as Save would read it: the number, undefined when blank, else the text itself. */
export function runtimeNumberOf(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return undefined;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : trimmed;
}

/** What a Save would send, for the dirty comparison: typing the stored number back is clean. */
export function normalizeRuntime(draft: RuntimeDraft): unknown {
  const numbers = Object.fromEntries(
    RUNTIME_NUMBER_FIELDS.map((field) => [field, runtimeNumberOf(draft[field])]),
  );
  return { ...numbers, thinkingLevel: draft.thinkingLevel, mode: draft.mode, prompt: draft.prompt };
}

const changed = (draft: RuntimeDraft, baseline: RuntimeDraft, field: RuntimeNumberField) =>
  runtimeNumberOf(draft[field]) !== runtimeNumberOf(baseline[field]);

/**
 * The errors of the boxes that differ from the baseline (null when there are none). A box left
 * as it was is never judged: Save sends only what changed, so a stored value the server once
 * accepted cannot block an edit elsewhere.
 */
export function runtimeErrors(
  draft: RuntimeDraft,
  baseline: RuntimeDraft,
): Partial<Record<RuntimeNumberField, RuntimeNumberError>> | null {
  const errors: Partial<Record<RuntimeNumberField, RuntimeNumberError>> = {};
  for (const field of RUNTIME_NUMBER_FIELDS) {
    if (!changed(draft, baseline, field)) continue;
    const value = runtimeNumberOf(draft[field]);
    if (value === undefined) errors[field] = "cannotClear";
    else if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      (value <= 0 && value !== -1)
    ) {
      errors[field] = "invalid";
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

/**
 * The config update a Save sends: only the keys that differ from the baseline. Call it on a
 * draft without errors; a box that does not hold a number is left out.
 */
export function runtimeUpdateOf(
  draft: RuntimeDraft,
  baseline: RuntimeDraft,
): NonNullable<AgentConfigUpdateRequest["config"]> {
  const number = (field: RuntimeNumberField): number | undefined => {
    if (!changed(draft, baseline, field)) return undefined;
    const value = runtimeNumberOf(draft[field]);
    return typeof value === "number" ? value : undefined;
  };
  const config: NonNullable<AgentConfigUpdateRequest["config"]> = {};
  const maxTurns = number("maxTurns");
  if (maxTurns !== undefined) config.maxTurns = maxTurns;

  const model: AgentModelConfigDto = {};
  const maxTokens = number("maxTokens");
  if (maxTokens !== undefined) model.maxTokens = maxTokens;
  if (draft.thinkingLevel !== "" && draft.thinkingLevel !== baseline.thinkingLevel) {
    model.thinkingLevel = draft.thinkingLevel as AgentModelConfigDto["thinkingLevel"];
  }
  const timeoutMs = number("timeoutMs");
  if (timeoutMs !== undefined) model.timeoutMs = timeoutMs;
  if (Object.keys(model).length > 0) config.model = model;

  const compaction: AgentCompactionConfigDto = {};
  const maxContextLength = number("maxContextLength");
  if (maxContextLength !== undefined) compaction.maxContextLength = maxContextLength;
  const maxSessionTurns = number("maxSessionTurns");
  if (maxSessionTurns !== undefined) compaction.maxSessionTurns = maxSessionTurns;
  if (draft.mode !== "" && draft.mode !== baseline.mode) {
    compaction.mode = draft.mode as AgentCompactionConfigDto["mode"];
  }
  if (draft.prompt !== baseline.prompt) compaction.prompt = draft.prompt;
  if (Object.keys(compaction).length > 0) config.compaction = compaction;
  return config;
}
