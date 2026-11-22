/**
 * The operations this plugin offers, and how each becomes one MMSP request.
 *
 * Seven run on the model a `[tools]` binding names (the binding keys are the operation names);
 * image understanding (`i2t`) runs on the Project's vision model, the one that already reads
 * images for a text-only chat model, so there is no binding for it. The same input reaches an
 * operation from the CLI and from the routes; both hand it over in the shape below.
 */
import type { ContentItem, UniConfig, UniMessage } from "@prismshadow/mmsp";
import { badInput } from "./errors.js";

/** The package these operations belong to: the first half of every request's `purpose`. */
export const PACKAGE = "@penguinharness/multimodal-tools";

export const OPERATIONS = ["t2t", "i2t", "search", "fetch", "t2i", "t2v", "t2s", "s2t"] as const;
export type Operation = (typeof OPERATIONS)[number];

/** A generated file's kind, by its MIME type's top level. */
export type MediaKind = "image" | "video" | "audio";

/** What a completed run of an operation has to carry. */
export type ResultKind = "text" | "sources" | MediaKind;

/** The binding whose model runs an operation; undefined for `i2t`, which runs on the vision model. */
export function bindingOf(op: Operation): string | undefined {
  return op === "i2t" ? undefined : op;
}

export function resultOf(op: Operation): ResultKind {
  switch (op) {
    case "search":
    case "fetch":
      return "sources";
    case "t2i":
      return "image";
    case "t2v":
      return "video";
    case "t2s":
      return "audio";
    default:
      return "text";
  }
}

export function isOperation(value: string): value is Operation {
  return (OPERATIONS as readonly string[]).includes(value);
}

/** A file handed to an operation. */
export interface Attachment {
  data: Uint8Array;
  mimeType: string;
}

/** An operation's input, whichever surface it came from. */
export interface OperationInput {
  /** The text, prompt or query (t2t, t2i, t2v, t2s, search) or the question about an image (i2t). */
  text?: string;
  /** The page to fetch. */
  url?: string;
  /** The image to read (i2t). */
  image?: Attachment;
  /** The recording to transcribe (s2t). */
  audio?: Attachment;
  /** At most this many search results. */
  count?: number;
  /** The provider's voice name (t2s). */
  voice?: string;
  aspectRatio?: string;
  resolution?: string;
  /** Whole seconds of video. */
  duration?: number;
}

/** The longest text an operation takes. */
export const MAX_TEXT_CHARS = 100_000;
/** The largest file an operation takes. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

const ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9", "21:9"] as const;
const IMAGE_RESOLUTIONS = ["1K", "2K"] as const;
const VIDEO_RESOLUTIONS = ["360p", "720p", "1080p", "4K"] as const;
const IMAGE_TYPES = /^image\/(?:png|jpeg|webp|gif)$/i;
const AUDIO_TYPE = /^audio\/[a-z0-9.+-]+(?:\s*;[\w =.-]+)*$/i;

function text(value: string | undefined, what: string): string {
  if (value === undefined || value.trim() === "") throw badInput(`Provide ${what}.`);
  if (value.length > MAX_TEXT_CHARS) {
    throw badInput(`The ${what} is longer than ${MAX_TEXT_CHARS.toLocaleString("en")} characters.`);
  }
  return value;
}

function choice<T extends string>(
  value: string | undefined,
  options: readonly T[],
  what: string,
): T | undefined {
  if (value === undefined) return undefined;
  if (!(options as readonly string[]).includes(value)) {
    throw badInput(
      `Unsupported ${what} '${value.slice(0, 32)}': use one of ${options.join(", ")}.`,
    );
  }
  return value as T;
}

function integer(value: number | undefined, min: number, max: number, what: string) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw badInput(`The ${what} must be a whole number from ${min} to ${max}.`);
  }
  return value;
}

function attachment(file: Attachment | undefined, kind: "image" | "audio"): ContentItem {
  if (file === undefined) throw badInput(`Provide the ${kind} file.`);
  const mimeType = file.mimeType.trim();
  if (mimeType.length > 128 || !(kind === "image" ? IMAGE_TYPES : AUDIO_TYPE).test(mimeType)) {
    throw badInput(
      kind === "image"
        ? "Provide a PNG, JPEG, WebP or GIF image."
        : `'${mimeType.slice(0, 64)}' is not an audio type.`,
    );
  }
  if (file.data.byteLength === 0) throw badInput(`The ${kind} file is empty.`);
  if (file.data.byteLength > MAX_ATTACHMENT_BYTES) {
    throw badInput(`The ${kind} file is larger than ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MiB.`);
  }
  return { type: "inline_data.done", mime_type: mimeType, data: Buffer.from(file.data) };
}

function pageUrl(value: string | undefined): string {
  const raw = text(value, "the URL of a page");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw badInput("Provide an http:// or https:// URL.");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw badInput("Provide an http:// or https:// URL without credentials.");
  }
  return url.href;
}

/** The question an image is read with when the caller asks none. */
export const DEFAULT_IMAGE_PROMPT = "Describe this image.";

/** One operation's MMSP request: its user message and its config. Throws a 400 on bad input. */
export function operationRequest(
  op: Operation,
  input: OperationInput,
): { messages: UniMessage[]; config: UniConfig } {
  const config: UniConfig = {};
  let items: ContentItem[];
  switch (op) {
    case "i2t":
      items = [
        {
          type: "text.done",
          text: input.text?.trim() ? text(input.text, "a question") : DEFAULT_IMAGE_PROMPT,
        },
        attachment(input.image, "image"),
      ];
      break;
    case "s2t":
      items = [attachment(input.audio, "audio")];
      break;
    case "fetch":
      items = [{ type: "text.done", text: pageUrl(input.url) }];
      break;
    case "search": {
      items = [{ type: "text.done", text: text(input.text, "a search query") }];
      const count = integer(input.count, 1, 50, "result count");
      if (count !== undefined) config.webtool_config = { count };
      break;
    }
    case "t2s": {
      items = [{ type: "text.done", text: text(input.text, "the text to speak") }];
      if (input.voice !== undefined) {
        const voice = input.voice.trim();
        if (voice === "" || voice.length > 160)
          throw badInput("Provide a voice name of up to 160 characters.");
        config.tts_config = [{ voice }];
      }
      break;
    }
    case "t2i": {
      items = [{ type: "text.done", text: text(input.text, "an image prompt") }];
      const aspect_ratio = choice(input.aspectRatio, ASPECT_RATIOS, "aspect ratio");
      const resolution = choice(input.resolution, IMAGE_RESOLUTIONS, "image resolution");
      if (aspect_ratio !== undefined || resolution !== undefined) {
        config.image_config = {
          ...(aspect_ratio !== undefined ? { aspect_ratio } : {}),
          ...(resolution !== undefined ? { resolution } : {}),
        };
      }
      break;
    }
    case "t2v": {
      items = [{ type: "text.done", text: text(input.text, "a video prompt") }];
      const aspect_ratio = choice(input.aspectRatio, ASPECT_RATIOS, "aspect ratio");
      const resolution = choice(input.resolution, VIDEO_RESOLUTIONS, "video resolution");
      const duration = integer(input.duration, 1, 120, "duration in seconds");
      if (aspect_ratio !== undefined || resolution !== undefined || duration !== undefined) {
        config.video_config = {
          ...(aspect_ratio !== undefined ? { aspect_ratio } : {}),
          ...(resolution !== undefined ? { resolution } : {}),
          ...(duration !== undefined ? { duration } : {}),
        };
      }
      break;
    }
    case "t2t":
      items = [{ type: "text.done", text: text(input.text, "the text or instructions") }];
      break;
  }
  return { messages: [{ role: "user", content_items: items }], config };
}
