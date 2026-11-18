import type {
  AspectRatio,
  ContentItem,
  ImageResolution,
  UniConfig,
  VideoResolution,
} from "@prismshadow/mmsp";
import { modelOperation } from "@prismshadow/penguin-core";
import type { ModelOperation as Capability, CapabilitySettingsPatch } from "../api/capabilities.js";
import type { ModelRefDto } from "../api/types.js";
import { badRequest } from "../http/errors.js";

export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw badRequest(label + " must be an object.");
  return value as Record<string, unknown>;
}
function ref(value: unknown): ModelRefDto | null {
  if (value === null) return null;
  const r = object(value, "model");
  if (typeof r.provider !== "string" || typeof r.modelId !== "string" || !r.provider || !r.modelId)
    throw badRequest("A model requires a provider and modelId.");
  return { provider: r.provider, modelId: r.modelId };
}
export function settingsPatch(body: Record<string, unknown>): CapabilitySettingsPatch<Capability> {
  const patch: CapabilitySettingsPatch<Capability> = {};
  if (body.bindings !== undefined) {
    patch.bindings = {};
    for (const [key, val] of Object.entries(object(body.bindings, "bindings"))) {
      const op = modelOperation(key);
      if (!op) throw badRequest("Unknown capability: " + key);
      patch.bindings[op] = ref(val);
    }
  }
  if (body.voicePolish !== undefined) {
    const v = object(body.voicePolish, "voicePolish");
    patch.voicePolish = {};
    if (v.enabled !== undefined) {
      if (typeof v.enabled !== "boolean") throw badRequest("enabled must be a boolean.");
      patch.voicePolish.enabled = v.enabled;
    }
    if (v.model !== undefined) patch.voicePolish.model = ref(v.model);
  }
  if (!patch.bindings && !patch.voicePolish) throw badRequest("Provide bindings or voicePolish.");
  return patch;
}
export function inputText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 100000)
    throw badRequest("Provide text between 1 and 100,000 characters.");
  return value;
}
function choice<T extends string>(
  value: unknown,
  options: readonly T[],
  label: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !options.includes(value as T))
    throw badRequest("Unsupported " + label + ".");
  return value as T;
}
function integer(value: unknown, min: number, max: number, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max)
    throw badRequest(label + " is outside the supported range.");
  return value;
}
export function capabilityInput(
  cap: Capability,
  body: Record<string, unknown>,
): { item: ContentItem; options: UniConfig } {
  const options: UniConfig = {};
  if (cap === "stt" || cap === "i2t") {
    const image = cap === "i2t";
    const kind = image ? "image" : "audio";
    const { data, mimeType } = object(body[kind], kind);
    if (
      typeof mimeType !== "string" ||
      !(
        image ? /^image\/(?:png|jpeg|webp|gif)$/i : /^audio\/[a-z0-9.+-]+(?:\s*;[\w =.-]+)*$/i
      ).test(mimeType) ||
      mimeType.length > 128
    )
      throw badRequest("Provide a supported " + kind + " MIME type.");
    if (
      typeof data !== "string" ||
      !data.length ||
      data.length > Math.ceil(MAX_AUDIO_BYTES / 3) * 4 ||
      data.length % 4 ||
      !/^[a-z0-9+/]+={0,2}$/i.test(data)
    )
      throw badRequest("Provide a base64 " + kind + " file up to 20 MiB.");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > MAX_AUDIO_BYTES) throw badRequest("Attachment exceeds 20 MiB.");
    return { item: { type: "inline_data.done", mime_type: mimeType, data: bytes }, options };
  }
  const text = inputText(cap === "fetch" ? body.url : body.text);
  if (cap === "fetch") {
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw badRequest("Provide an HTTP or HTTPS URL.");
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      throw badRequest("Provide an HTTP or HTTPS URL without credentials.");
  }
  if (cap === "search" && body.count !== undefined)
    options.webtool_config = { count: integer(body.count, 1, 50, "count") };
  if (cap === "tts" && body.voice !== undefined) {
    const voice = inputText(body.voice);
    if (voice.length > 160) throw badRequest("The voice name is too long.");
    options.tts_config = [{ voice }];
  }
  if (cap === "image" || cap === "video") {
    const aspect = choice<AspectRatio>(
      body.aspectRatio,
      ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"],
      "aspect ratio",
    );
    if (cap === "image" && (aspect || body.resolution !== undefined))
      options.image_config = {
        aspect_ratio: aspect,
        resolution: choice<ImageResolution>(body.resolution, ["1K", "2K"], "image resolution"),
      };
    if (cap === "video" && (aspect || body.duration !== undefined || body.resolution !== undefined))
      options.video_config = {
        aspect_ratio: aspect,
        resolution: choice<VideoResolution>(
          body.resolution,
          ["360p", "720p", "1080p", "4K"],
          "video resolution",
        ),
        duration: integer(body.duration, 1, 120, "duration"),
      };
  }
  return { item: { type: "text.done", text }, options };
}
