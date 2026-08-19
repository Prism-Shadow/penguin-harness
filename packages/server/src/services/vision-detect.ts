/**
 * Vision capability detection for a configured model.
 *
 * The models dialog can leave "supports vision" unset and ask the model itself. Unlike the
 * protocol probes (services/protocol-detect.ts), this cannot be a deliberately invalid
 * request: the only way to learn whether an endpoint accepts image input is to send an
 * image and see what comes back. So this probe **is a real, billed completion** on the
 * user's credential. Everything here exists to make it the cheapest honest one:
 *
 *   - a 1x1 PNG (67 bytes) — the smallest thing that is still a decodable image;
 *   - a prompt asking for one word, with the same anti-thinking hint the connectivity
 *     probe uses, so reasoning models do not burn the budget before answering;
 *   - `maxTokens` in the single digits and no tools, so the completion cannot run long.
 *
 * Verdict, deliberately three-valued — "it didn't work" and "it works and the answer is
 * no" are different facts, and only the first is worth telling the user to go check their
 * credentials over:
 *   - `supported`   the model accepted the image and answered;
 *   - `unsupported` the model answered *about the image being unacceptable* — a modality
 *     rejection is a definitive negative, not an error;
 *   - `failed`      anything else (auth, network, timeout, an unrelated 400): the probe
 *     learned nothing, so the capability stays exactly as the user left it.
 */
import type { LLMOutcome } from "@prismshadow/penguin-core";

/** What one vision probe concluded. */
export type VisionProbeOutcome = "supported" | "unsupported" | "failed";

/**
 * A 1x1 transparent PNG as a data URL — the smallest input that still decodes as an image
 * for every provider. Inline rather than read from disk: it must not depend on packaging.
 */
export const VISION_PROBE_IMAGE =
  "data:image/png;base64," +
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

/**
 * Vision probe prompt: one word out, no reasoning. Mirrors the connectivity probe's
 * trailing empty <think></think>, which many reasoning models read as "thinking already
 * closed" — without it the tiny output budget is spent before any answer appears.
 */
export const VISION_PROBE_PROMPT =
  'Reply with the single word "ok" and nothing else. Do not think or explain.\n<think></think>';

/** Output cap for the probe: enough for one word, nothing more. */
export const VISION_PROBE_MAX_TOKENS = 8;

/** Request timeout, matching the connectivity test. */
export const VISION_PROBE_TIMEOUT_MS = 20_000;

/**
 * Error fragments that mean "this model/endpoint will not take an image", as opposed to
 * "the request failed". Matched case-insensitively against the provider's error text.
 *
 * Kept broad on purpose: providers word this very differently (OpenAI-compatible servers
 * talk about the content part type, Anthropic about the block type, gateways about the
 * modality), and the cost of a miss is asymmetric — classifying a real modality rejection
 * as `failed` merely shows the generic "check your key and URL" message, which is
 * confusing but harmless, while the reverse would switch vision OFF on a working model.
 * So every pattern here names an image/modality concept explicitly; nothing matches on a
 * bare "invalid request".
 */
const UNSUPPORTED_PATTERNS: readonly string[] = [
  "image_url",
  "image url",
  "does not support image",
  "not support image",
  "unsupported image",
  "image input",
  "image content",
  "invalid image",
  "vision",
  "multimodal",
  "modality",
  "image is not supported",
  "no support for image",
  "content type 'image",
  'content type "image',
  "unsupported content",
  "cannot process image",
  "image not supported",
];

/**
 * Whether a provider error says the model refused the IMAGE specifically. Only consulted
 * for a failed completion, so an ordinary success never reaches it.
 */
export function isImageRejection(message: string): boolean {
  const m = message.toLowerCase();
  return UNSUPPORTED_PATTERNS.some((p) => m.includes(p));
}

/**
 * Classify one probe run. `sawContent` mirrors the connectivity test's allowance: a model
 * that streamed real content and then tripped its tiny cap has demonstrably accepted the
 * image, which is the whole question here.
 */
export function classifyVisionProbe(outcome: LLMOutcome, sawContent: boolean): VisionProbeOutcome {
  if (outcome.status === "completed") return "supported";
  if (sawContent) return "supported";
  const detail =
    "errorMessage" in outcome && outcome.errorMessage ? outcome.errorMessage : outcome.status;
  return isImageRejection(String(detail)) ? "unsupported" : "failed";
}

/**
 * Classify a thrown error (the SDK can throw during construction or the first chunk, e.g.
 * on a missing credential). Same rule: only an image-specific complaint is a real "no".
 */
export function classifyVisionProbeError(err: unknown): VisionProbeOutcome {
  const message = err instanceof Error ? err.message : String(err);
  return isImageRejection(message) ? "unsupported" : "failed";
}
