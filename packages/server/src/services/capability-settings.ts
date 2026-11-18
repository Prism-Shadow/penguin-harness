import { listSupportedModels } from "@prismshadow/mmsp";
import { routedClientType } from "@prismshadow/mmsp/credentials";
import {
  MODEL_TOOL_KEYS,
  type ModelOperation,
  getModel,
  providerConnectionShape,
  resolveEntryCredential,
  type ModelEntry,
  type ProjectConfig,
  type ModelRef,
} from "@prismshadow/penguin-core";
import type {
  ModelOperation as Capability,
  AvailableCapability,
  CapabilitySettings,
  CapabilitySettingsPatch,
  ToolModelSettings,
} from "../api/capabilities.js";
import type { ModelRefDto } from "../api/types.js";
import { badRequest } from "../http/errors.js";

const models = listSupportedModels();
const operations = Object.keys(MODEL_TOOL_KEYS) as ModelOperation[];
export const dto = (m: ModelRef): ModelRefDto => ({ provider: m.provider, modelId: m.model_id });
export const rawRef = (m: ModelRefDto): ModelRef => ({ provider: m.provider, model_id: m.modelId });
function modelClient(row: ModelEntry, config: ProjectConfig) {
  const conn = resolveEntryCredential(
    row,
    providerConnectionShape(config.providers?.[row.provider]),
  );
  return routedClientType(row.model_id, conn.clientType);
}
function dictationFormat(config: ProjectConfig): CapabilitySettings<Capability>["dictationFormat"] {
  const ref = config.tools?.s2t;
  const row = ref && getModel(config, ref);
  if (!row) return;
  const client = modelClient(row, config);
  if (client === "deepseek-transcription" || (client === "mmsp" && row.model_id === "deepseek-asr"))
    return "audio/wav";
}
function destinations(row: ModelEntry, config: ProjectConfig): Capability[] {
  const client = modelClient(row, config);
  if (!client) return [];
  if (client === "openai-image") return ["image"];
  if (client === "openai-speech" || client === "deepseek-speech") return ["tts"];
  if (client === "openai-transcription" || client === "deepseek-transcription") return ["stt"];
  if (client === "openai-embedding") return [];
  const known = models.find(
    (m) => m.model === row.model_id && (m.client === client || client === "mmsp"),
  );
  if (
    client === "deepseek-webtool" ||
    client === "jina-webtool" ||
    known?.output_modalities.includes("Web")
  )
    return row.model_id.includes("fetch")
      ? ["fetch"]
      : row.model_id.includes("search")
        ? ["search"]
        : [];
  if (!known) return row.vision === false ? ["t2t"] : ["t2t", "i2t"];
  const input = known.input_modalities,
    out = known.output_modalities;
  const keys: Capability[] = [];
  if (input.includes("Text") && out.includes("Video")) keys.push("video");
  if (input.includes("Text") && out.includes("Image")) keys.push("image");
  if (input.includes("Text") && out.includes("Audio")) keys.push("tts");
  if (out.includes("Text")) {
    if (input.includes("Text")) keys.push("t2t");
    if (input.includes("Image") && row.vision !== false) keys.push("i2t");
    if (input.length === 1 && input.includes("Audio")) keys.push("stt");
  }
  return keys;
}
export function capabilitySettings(
  config: ProjectConfig,
): Omit<CapabilitySettings<Capability>, "available"> {
  const candidates: CapabilitySettings<Capability>["candidates"] = {
    search: [],
    fetch: [],
    image: [],
    video: [],
    stt: [],
    tts: [],
    chat: [],
    t2t: [],
    i2t: [],
  };
  for (const row of config.models) {
    for (const key of destinations(row, config)) candidates[key].push(dto(row));
  }
  candidates.chat = candidates.t2t;
  const bindings: CapabilitySettings<Capability>["bindings"] = {};
  for (const key of operations) {
    const ref = config.tools?.[MODEL_TOOL_KEYS[key]];
    if (ref) bindings[key] = dto(ref);
  }
  return {
    bindings,
    candidates,
    dictationFormat: dictationFormat(config),
    voicePolish: {
      enabled: config.voice_polish_enabled ?? false,
      model: config.tools?.t2t ? dto(config.tools.t2t) : null,
    },
  };
}
export function projectCapabilities(
  config: ProjectConfig,
  available: AvailableCapability<Capability>[],
): CapabilitySettings<Capability> {
  const settings = capabilitySettings(config);
  const visible = new Set(available.map((c) => c.key));
  for (const key of operations) if (!visible.has(key)) settings.candidates[key] = [];
  return { ...settings, available };
}

export function applyCapabilitySettings(
  config: ProjectConfig,
  patch: CapabilitySettingsPatch<Capability>,
) {
  const current = capabilitySettings(config);
  const requireCandidate = (key: Capability | "chat", ref: ModelRefDto) => {
    if (
      !current.candidates[key].some(
        (row) => row.provider === ref.provider && row.modelId === ref.modelId,
      )
    )
      throw badRequest("Select a project model that supports " + key + ".");
  };
  const tools = { ...config.tools };
  const edits = { ...patch.bindings };
  // Legacy clients selected the editing model through voicePolish.model.
  if (edits.t2t === undefined && patch.voicePolish?.model !== undefined)
    edits.t2t = patch.voicePolish.model;
  for (const op of operations) {
    const ref = edits[op];
    if (ref === undefined) continue;
    const key = MODEL_TOOL_KEYS[op];
    if (ref === null) delete tools[key];
    else {
      requireCandidate(op, ref);
      tools[key] = rawRef(ref);
    }
  }
  let enabled = patch.voicePolish?.enabled ?? config.voice_polish_enabled ?? false;
  if (enabled && !tools.t2t) {
    if (patch.voicePolish?.enabled === true)
      throw badRequest("Choose a text tool model for transcript editing.");
    enabled = false;
  }
  return { tools, voice_polish_enabled: enabled };
}
export function canonicalToolSettings(settings: CapabilitySettings<Capability>): ToolModelSettings {
  const bindings: ToolModelSettings["bindings"] = {};
  const candidates = {} as ToolModelSettings["candidates"];
  for (const op of operations) {
    const key = MODEL_TOOL_KEYS[op];
    candidates[key] = settings.candidates[op];
    if (settings.bindings[op]) bindings[key] = settings.bindings[op];
  }
  return {
    available: settings.available.map((entry) => ({ ...entry, key: MODEL_TOOL_KEYS[entry.key] })),
    bindings,
    candidates,
    dictationFormat: settings.dictationFormat,
    voicePolish: { enabled: settings.voicePolish.enabled },
  };
}

/** Original six-operation settings API. Clients that switch on its keys can upgrade independently. */
export function legacyToolSettings(settings: CapabilitySettings<Capability>): CapabilitySettings {
  const { t2t: _text, i2t: _vision, ...bindings } = settings.bindings;
  const { t2t: _t, i2t: _i, ...candidates } = settings.candidates;
  const available = settings.available.flatMap((entry) =>
    entry.key === "t2t" || entry.key === "i2t" ? [] : [{ ...entry, key: entry.key }],
  );
  return { ...settings, available, bindings, candidates };
}
