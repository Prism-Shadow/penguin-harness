import { routedClientType } from "@prismshadow/mmsp/credentials";
import {
  AutoLLMClient,
  EmptyResponseError,
  IncompleteStreamError,
  UpstreamError,
} from "@prismshadow/mmsp";
import type { UniConfig, UniMessage, UsageMetadata, WebData } from "@prismshadow/mmsp";
import {
  getModel,
  providerConnectionShape,
  resolveEntryCredential,
  type ProjectConfig,
} from "@prismshadow/penguin-core";
import type { CapabilityInputMeter, CapabilityResult } from "../api/capabilities.js";
import type { ModelRefDto } from "../api/types.js";
import { matchesRegistryRoute } from "./capability-cost.js";
import { catalogEntryFor } from "../model-catalog/catalog.js";
import { HttpError } from "../http/errors.js";

export interface ModelMedia {
  /** Derived only from the returned PCM sample count and its stated format. */
  seconds?: number;
  data: Buffer;
  mimeType: string;
}
export interface ModelOutput {
  text: string;
  sources: WebData[];
  media: ModelMedia[];
  usage: UsageMetadata | null;
  inputMeter?: CapabilityInputMeter;
}

function inputMeter(
  client: string | null,
  usage: UsageMetadata | null,
  billableWebRequests: number | undefined,
): CapabilityInputMeter | undefined {
  const quantity = usage?.prompt_tokens;
  if (quantity == null || !Number.isFinite(quantity) || quantity < 0) return;
  switch (client) {
    case null:
    case "mmsp":
      // The remote MMSP server chooses its own upstream adapter.
      return;
    case "deepseek-webtool":
      return billableWebRequests === undefined
        ? undefined
        : { unit: "billable_request", quantity: billableWebRequests };
    case "deepseek-transcription":
    case "openai-transcription":
      // Both adapters report only a duration rounded up to whole seconds.
      return { unit: "billed_audio_second", quantity };
    case "deepseek-speech":
      return { unit: "billed_character", quantity };
    case "openai-speech":
      // The adapter counts the UTF-8 script bytes even if the endpoint uses a model alias.
      return { unit: "utf8_byte", quantity };
    default:
      return { unit: "token", quantity };
  }
}

function protocolUsage(value: unknown): UsageMetadata | null {
  if (!value || typeof value !== "object") return null;
  const fields = value as Partial<UsageMetadata>;
  const usage: UsageMetadata = {
    cached_tokens: fields.cached_tokens ?? null,
    prompt_tokens: fields.prompt_tokens ?? null,
    thoughts_tokens: fields.thoughts_tokens ?? null,
    response_tokens: fields.response_tokens ?? null,
  };
  return Object.values(usage).every((n) => n === null || (Number.isSafeInteger(n) && n >= 0))
    ? usage
    : null;
}

function errorUsage(error: unknown): unknown {
  if (error instanceof EmptyResponseError || error instanceof IncompleteStreamError)
    return error.usageMetadata;
  // A remote MMSP server wraps the same typed errors in an SSE error envelope.
  if (
    error instanceof UpstreamError &&
    error.client === "MmspClient" &&
    (error.errorType === "EmptyResponseError" || error.errorType === "IncompleteStreamError")
  )
    return error.error.usage_metadata;
  return null;
}

export interface ModelRunContext {
  signal: AbortSignal;
  sessionId?: string;
  capability?: CapabilityResult["capability"];
  onUsage?: (
    usage: UsageMetadata,
    input?: CapabilityInputMeter,
    registryRouteMatched?: true,
  ) => void;
}

export async function runProjectModel(
  config: ProjectConfig,
  ref: ModelRefDto,
  messages: UniMessage[],
  options: UniConfig,
  { signal, sessionId, capability, onUsage }: ModelRunContext,
): Promise<ModelOutput> {
  signal.throwIfAborted();
  const entry = getModel(config, { provider: ref.provider, model_id: ref.modelId });
  if (!entry)
    throw new HttpError(
      409,
      "model_unavailable",
      "The selected model is no longer in the project.",
    );
  const connection = resolveEntryCredential(
    entry,
    providerConnectionShape(config.providers?.[ref.provider]),
  );
  const client = new AutoLLMClient({ model: entry.model_id, ...connection });
  const result: ModelOutput = { text: "", sources: [], media: [], usage: null };
  const chunks: string[] = [];
  let size = 0;
  let billableWebRequests = 0;
  const clientType = routedClientType(entry.model_id, connection.clientType);
  const preset = catalogEntryFor(ref.provider, ref.modelId);
  const registryRouteMatched = matchesRegistryRoute(preset, connection) || undefined;
  // A remote MMSP server selects its own adapter. A cataloged tool still has a
  // known input unit; generic text operations use tokens even on a custom server.
  const meterClient =
    clientType === "mmsp"
      ? preset?.capability && preset.capability === capability
        ? routedClientType(ref.modelId, preset.clientType)
        : capability === "t2t" || capability === "i2t" || capability === "voice-polish"
          ? "text"
          : null
      : clientType;
  const captureUsage = (raw: unknown, webRequests: number | undefined) => {
    if (result.usage) return;
    const usage = protocolUsage(raw);
    if (!usage) return;
    result.usage = usage;
    result.inputMeter = inputMeter(meterClient, usage, webRequests);
    onUsage?.(usage, result.inputMeter, registryRouteMatched);
  };
  const requestConfig = sessionId ? { ...options, session_id: sessionId } : options;
  try {
    for await (const event of client.streamingResponse({
      messages,
      config: requestConfig,
      signal,
    })) {
      if (event.event_type === "stop" && event.usage_metadata)
        captureUsage(event.usage_metadata, billableWebRequests);
      signal.throwIfAborted();
      for (const item of event.content_items) {
        if (item.type === "text.done") chunks.push(item.text);
        if (item.type === "webtool.done") {
          result.sources.push(...item.webdata);
          // DeepSeek charges separately for each answer that contains a search result or page content.
          if (
            meterClient === "deepseek-webtool" &&
            item.webdata.some(
              (source) =>
                !entry.model_id.toLowerCase().includes("-fetch") ||
                source.content.trim().length > 0,
            )
          )
            billableWebRequests++;
        }
        if (item.type === "inline_data.done") {
          size += item.data.byteLength;
          if (size > 256 * 1024 * 1024)
            throw new HttpError(502, "result_too_large", "The generated files exceed 256 MiB.");
          result.media.push({ mimeType: item.mime_type, data: Buffer.from(item.data) });
        }
      }
    }
  } catch (error) {
    captureUsage(errorUsage(error), undefined);
    throw error;
  }
  result.text = chunks.join("");
  return result;
}

/** MMSP returns whole little-endian 16-bit PCM frames for Gemini and DeepSeek. */
export function playableMedia(media: ModelMedia): ModelMedia {
  const { mimeType, data } = media;
  if (!/^audio\/(?:l16|pcm)(?:\s*;|$)/i.test(mimeType)) return media;
  const reportedRate = /(?:^|;)\s*rate\s*=\s*(\d+)/i.exec(mimeType)?.[1];
  const rate = Number(reportedRate ?? 24000);
  const channels = Number(/(?:^|;)\s*channels\s*=\s*(\d+)/i.exec(mimeType)?.[1] ?? 1);
  if (
    rate < 1 ||
    rate > 384000 ||
    channels < 1 ||
    channels > 16 ||
    data.length % (channels * 2) !== 0
  )
    throw new HttpError(502, "invalid_audio", "The model returned invalid PCM audio.");
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(data.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return {
    mimeType: "audio/wav",
    data: Buffer.concat([header, data]),
    ...(reportedRate ? { seconds: data.length / (channels * 2 * rate) } : {}),
  };
}
