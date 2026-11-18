import type { ModelRef } from "./project-config.js";

/** The keys in the Project's [tools] table. Each names one independently selectable model. */
export const TOOL_MODEL_KEYS = [
  "t2t",
  "i2t",
  "search",
  "fetch",
  "t2i",
  "t2v",
  "t2s",
  "s2t",
] as const;
export type ToolModelKey = (typeof TOOL_MODEL_KEYS)[number];
export type ToolModels = Partial<Record<ToolModelKey, ModelRef>>;

/** Earlier CLI names remain valid and historical usage records retain their original spelling. */
export const MODEL_TOOL_KEYS = {
  t2t: "t2t",
  i2t: "i2t",
  search: "search",
  fetch: "fetch",
  image: "t2i",
  video: "t2v",
  tts: "t2s",
  stt: "s2t",
} as const satisfies Record<string, ToolModelKey>;
export type ModelOperation = keyof typeof MODEL_TOOL_KEYS;
export function modelOperation(key: string): ModelOperation | undefined {
  if (Object.hasOwn(MODEL_TOOL_KEYS, key)) return key as ModelOperation;
  return (Object.keys(MODEL_TOOL_KEYS) as ModelOperation[]).find(
    (op) => MODEL_TOOL_KEYS[op] === key,
  );
}
function table(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Shared by both config readers. Remove the upgrade step at the 0.3.0 compatibility review
 * after deployed Projects have been rewritten. Unknown top-level data stays in the raw table. */
export function migrateToolModels(raw: Record<string, unknown>): boolean {
  if (!("vision_model" in raw || "capability_models" in raw || "voice_polish" in raw)) return false;
  const tools = { ...table(raw.tools) };
  const assign = (key: ToolModelKey, value: unknown) => {
    if (!(key in tools) && value !== undefined) tools[key] = value;
  };
  for (const [key, value] of Object.entries(table(raw.capability_models))) {
    const op = modelOperation(key);
    if (op) assign(MODEL_TOOL_KEYS[op], value);
  }
  assign("i2t", raw.vision_model);
  const polish = table(raw.voice_polish);
  assign("t2t", polish.model ?? (polish.enabled === true ? raw.default_model : undefined));
  if (Object.keys(tools).length) raw.tools = tools;
  if (raw.voice_polish_enabled === undefined && typeof polish.enabled === "boolean") {
    raw.voice_polish_enabled = polish.enabled;
  }
  delete raw.vision_model;
  delete raw.capability_models;
  delete raw.voice_polish;
  return true;
}
