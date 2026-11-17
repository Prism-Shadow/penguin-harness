import { AutoLLMClient } from "@prismshadow/mmsp";
import type { UniConfig, UniMessage, UsageMetadata, WebData } from "@prismshadow/mmsp";
import {
  getModel,
  providerConnectionShape,
  resolveEntryCredential,
  type ProjectConfig,
} from "@prismshadow/penguin-core";
import type { ModelRefDto } from "../api/types.js";
import { HttpError } from "../http/errors.js";

export interface ModelMedia {
  data: Buffer;
  mimeType: string;
}
export interface ModelOutput {
  text: string;
  sources: WebData[];
  media: ModelMedia[];
  usage: UsageMetadata | null;
}

export async function runProjectModel(
  config: ProjectConfig,
  ref: ModelRefDto,
  messages: UniMessage[],
  options: UniConfig,
  signal: AbortSignal,
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
  for await (const event of client.streamingResponse({ messages, config: options, signal })) {
    signal.throwIfAborted();
    for (const item of event.content_items) {
      if (item.type === "text.done") chunks.push(item.text);
      if (item.type === "webtool.done") result.sources.push(...item.webdata);
      if (item.type === "inline_data.done") {
        size += item.data.byteLength;
        if (size > 256 * 1024 * 1024)
          throw new HttpError(502, "result_too_large", "The generated files exceed 256 MiB.");
        result.media.push({ mimeType: item.mime_type, data: Buffer.from(item.data) });
      }
    }
    if (event.event_type === "stop") result.usage = event.usage_metadata;
  }
  result.text = chunks.join("");
  return result;
}

/** MMSP returns whole little-endian 16-bit PCM frames for Gemini and DeepSeek. */
export function playableMedia(media: ModelMedia): ModelMedia {
  const { mimeType, data } = media;
  if (!/^audio\/(?:l16|pcm)(?:\s*;|$)/i.test(mimeType)) return media;
  const rate = Number(/(?:^|;)\s*rate\s*=\s*(\d+)/i.exec(mimeType)?.[1] ?? 24000);
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
  return { mimeType: "audio/wav", data: Buffer.concat([header, data]) };
}
