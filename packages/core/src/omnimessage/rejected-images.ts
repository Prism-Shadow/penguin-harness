/**
 * Replacing the images of an LLM request's input with a text note, after the provider
 * rejected one of them.
 *
 * A provider can refuse an image with a 4xx — a format it does not decode, corrupt bytes, a
 * size or dimension past its limit, a model that takes no images at all — and while that
 * image stays in a turn's input, every request carrying it fails the same way. The engine
 * swaps every image in the turn's input for a note and retries; Trace replay applies the same
 * swap to the rejected attempt's input, so a resumed Session's history matches the one the
 * process had. The note is built only from what both sides hold — the image bytes and the
 * provider's error text as `request_end.error_message` records it — so it comes out
 * byte-identical on either side.
 *
 * The note is written for the model, which has to deal with the image on its own: it names
 * the image (format, pixel size, byte size), quotes the provider, says what usually causes
 * the refusal (providers often call an oversized image an unsupported format), and how to
 * make a copy the provider will take. It knows no model's limits; the sizes it suggests are
 * ones every image-taking provider accepts.
 *
 * Pure: new messages are built and the originals are never mutated — the Trace and the
 * render view keep showing the image as it was sent.
 */
import { userText } from "./builders.js";
import { describeImageUrl } from "./image-facts.js";
import type { ImageUrlPayload, OmniMessage, ToolCallOutputPayload } from "./types.js";

/** The longest provider error quoted in a note; the rest is cut with an ellipsis. */
const MAX_QUOTED_ERROR = 400;

/**
 * Why a provider refuses an image, as far as a model can act on it. Shared with read_file,
 * which says the same when the vision model reading for a text-only model refuses one.
 */
export const IMAGE_REJECTION_CAUSES =
  "Providers often call this an unsupported or invalid format even when the file is a valid " +
  "image: the usual cause is a side or a pixel count above the provider's limit (tall " +
  "full-page screenshots most of all) or a file above its size limit, and less often bytes " +
  "that are not a real PNG, JPEG, GIF or WebP.";

/** How to get a copy of an image file the provider will take (shared with read_file, like the causes). */
export const IMAGE_COPY_ADVICE =
  "If you still need the image, make a copy with a shell command (ImageMagick, Python Pillow, " +
  "ffmpeg or the platform's own image tool) and read_file the copy: cut a tall or wide image " +
  "into pieces of at most 2000 px on each side, scale any other image down so its longest " +
  "side is at most 2000 px, and re-encode bytes that are not a real image as PNG. Do not read " +
  "the original again: it is refused the same way.";

/** The same advice for an image the user attached, which the model holds no file of. */
const ATTACHED_IMAGE_ADVICE =
  "If you still need it, ask the user for a copy of at most 2000 px on each side, or for the " +
  "file's path so you can make one with a shell command.";

/** `Provider error: …` for a note, or nothing when the request ended without a message. */
function quotedError(providerError: string | undefined): string {
  const text = providerError?.trim();
  if (!text) return "";
  const cut = text.length > MAX_QUOTED_ERROR ? `${text.slice(0, MAX_QUOTED_ERROR)}…` : text;
  return ` Provider error: ${cut}`;
}

/** The note that stands in for the images of a tool output (one note, however many images). */
function toolOutputNote(images: readonly string[], providerError: string | undefined): string {
  const facts = images.map(describeImageUrl).join("; ");
  const what =
    images.length === 1
      ? `the image this tool returned (${facts})`
      : `the ${images.length} images this tool returned (${facts})`;
  return (
    `[image not sent: the model provider rejected ${what}, so the request was sent again ` +
    `without it.${quotedError(providerError)} ${IMAGE_REJECTION_CAUSES} ${IMAGE_COPY_ADVICE}]`
  );
}

/** The note that stands in for an image message (an image the user attached). */
function attachedImageNote(url: string, providerError: string | undefined): string {
  return (
    `[image not sent: the model provider rejected an image attached to this message ` +
    `(${describeImageUrl(url)}), so the request was sent again without it.` +
    `${quotedError(providerError)} ${IMAGE_REJECTION_CAUSES} ${ATTACHED_IMAGE_ADVICE}]`
  );
}

/** Whether a message carries an image: a tool output with `images`, or an `image_url` message. */
function carriesImage(msg: OmniMessage): boolean {
  const p = msg.payload as { type?: string; images?: unknown };
  if (p.type === "image_url") return true;
  return p.type === "tool_call_output" && Array.isArray(p.images) && p.images.length > 0;
}

/** Whether any message of a request's input carries an image (see {@link replaceInputImages}). */
export function hasInputImages(messages: readonly OmniMessage[]): boolean {
  return messages.some(carriesImage);
}

/**
 * Every image in `messages` replaced by a note; messages without images are returned as-is
 * (the same object). A tool output loses `images` and gets the note appended to its text,
 * keeping its pairing id, stop reason and envelope; an `image_url` message becomes a user
 * text holding the note, keeping its timestamp and origin. `providerError` is the rejected
 * request's error text (`LLMOutcome.errorMessage`, recorded as `request_end.error_message`),
 * quoted in each note.
 */
export function replaceInputImages(
  messages: readonly OmniMessage[],
  providerError?: string,
): OmniMessage[] {
  return messages.map((msg): OmniMessage => {
    if (!carriesImage(msg)) return msg;
    const p = msg.payload as ToolCallOutputPayload | ImageUrlPayload;
    if (p.type === "image_url") {
      return {
        ...userText(attachedImageNote(p.image_url, providerError)),
        timestamp: msg.timestamp,
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
      };
    }
    const { images, ...rest } = p;
    const note = toolOutputNote(images ?? [], providerError);
    const output = rest.output ? `${rest.output}\n${note}` : note;
    return { ...msg, payload: { ...rest, output } };
  });
}
