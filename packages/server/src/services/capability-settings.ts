import { listSupportedModels } from "@prismshadow/mmsp";
import { routedClientType } from "@prismshadow/mmsp/credentials";
import {
  MODEL_CAPABILITIES,
  providerConnectionShape,
  resolveEntryCredential,
  type ModelEntry,
  type ProjectConfig,
  type ModelRef,
} from "@prismshadow/penguin-core";
import type {
  Capability,
  CapabilitySettings,
  CapabilitySettingsPatch,
} from "../api/capabilities.js";
import type { ModelRefDto } from "../api/types.js";
import { badRequest } from "../http/errors.js";

const models = listSupportedModels();
export const dto = (m: ModelRef): ModelRefDto => ({ provider: m.provider, modelId: m.model_id });
export const rawRef = (m: ModelRefDto): ModelRef => ({ provider: m.provider, model_id: m.modelId });
function destination(row: ModelEntry, config: ProjectConfig): Capability | "chat" | undefined {
  const conn = resolveEntryCredential(
    row,
    providerConnectionShape(config.providers?.[row.provider]),
  );
  const client = routedClientType(row.model_id, conn.clientType);
  if (!client) return undefined;
  if (client === "openai-image") return "image";
  if (client === "openai-speech" || client === "deepseek-speech") return "tts";
  if (client === "openai-transcription" || client === "deepseek-transcription") return "stt";
  if (client === "openai-embedding") return undefined;
  if (client === "deepseek-webtool" || client === "jina-webtool")
    return row.model_id.includes("fetch")
      ? "fetch"
      : row.model_id.includes("search")
        ? "search"
        : undefined;
  const known = models.find(
    (m) => m.model === row.model_id && (m.client === client || client === "mmsp"),
  );
  if (!known) return "chat";
  const out = known.output_modalities;
  if (out.includes("Web")) return row.model_id.includes("fetch") ? "fetch" : "search";
  if (out.includes("Video")) return "video";
  if (out.includes("Image")) return "image";
  if (out.includes("Audio")) return "tts";
  if (out.includes("Text"))
    return known.input_modalities.length === 1 && known.input_modalities[0] === "Audio"
      ? "stt"
      : "chat";
  return undefined;
}
export function capabilitySettings(config: ProjectConfig): CapabilitySettings {
  const candidates: CapabilitySettings["candidates"] = {
    search: [],
    fetch: [],
    image: [],
    video: [],
    stt: [],
    tts: [],
    chat: [],
  };
  for (const row of config.models) {
    const key = destination(row, config);
    if (key) candidates[key].push(dto(row));
  }
  const bindings: CapabilitySettings["bindings"] = {};
  for (const key of MODEL_CAPABILITIES) {
    const ref = config.capability_models?.[key];
    if (ref) bindings[key] = dto(ref);
  }
  return {
    bindings,
    candidates,
    voicePolish: {
      enabled: config.voice_polish?.enabled ?? false,
      model: config.voice_polish?.model ? dto(config.voice_polish.model) : null,
    },
  };
}
export function applyCapabilitySettings(config: ProjectConfig, patch: CapabilitySettingsPatch) {
  const current = capabilitySettings(config);
  const requireCandidate = (key: Capability | "chat", ref: ModelRefDto) => {
    if (
      !current.candidates[key].some(
        (row) => row.provider === ref.provider && row.modelId === ref.modelId,
      )
    )
      throw badRequest("Select a project model that supports " + key + ".");
  };
  const bindings = { ...config.capability_models };
  for (const key of MODEL_CAPABILITIES) {
    const ref = patch.bindings?.[key];
    if (ref === undefined) continue;
    if (!ref) delete bindings[key];
    else {
      requireCandidate(key, ref);
      bindings[key] = rawRef(ref);
    }
  }
  const voice = { ...current.voicePolish, ...patch.voicePolish };
  if (voice.model) requireCandidate("chat", voice.model);
  if (voice.enabled && !voice.model) {
    if (!config.default_model)
      throw badRequest("Choose a model for transcript editing or configure a default chat model.");
    requireCandidate("chat", dto(config.default_model));
  }
  return {
    capability_models: bindings,
    voice_polish: {
      enabled: voice.enabled,
      ...(voice.model ? { model: rawRef(voice.model) } : {}),
    },
  };
}
