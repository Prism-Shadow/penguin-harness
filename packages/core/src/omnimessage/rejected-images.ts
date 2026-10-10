/**
 * Replacing the images of an LLM request's input with a fixed text note, after the provider
 * rejected one of them.
 *
 * A provider can refuse an image with a 4xx — a format it does not decode, corrupt bytes, a
 * size or dimension past its limit, a model that takes no images at all — and while that
 * image stays in a turn's input, every request carrying it fails the same way. The engine
 * swaps every image in the turn's input for the note below and retries; Trace replay applies
 * the same swap to the rejected attempt's input, so a resumed Session's history matches the
 * one the process had. Both sides call this module, which keeps the note byte-identical
 * between them. The model reads the note in place of the image, and it says what to do when
 * the picture is still needed.
 *
 * Pure: new messages are built and the originals are never mutated — the Trace and the
 * render view keep showing the image as it was sent.
 */
import { userText } from "./builders.js";
import type { ImageUrlPayload, OmniMessage, ToolCallOutputPayload } from "./types.js";

/** The text that stands in for each rejected image (one per tool output, whatever its count). */
export const IMAGE_REMOVED_NOTE =
  "[image removed: the model provider rejected this image as invalid or unsupported. " +
  "If it is still needed, convert it to PNG or JPEG and read the converted file.]";

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
 * Every image in `messages` replaced by {@link IMAGE_REMOVED_NOTE}; messages without images
 * are returned as-is (the same object). A tool output loses `images` and gets the note
 * appended to its text, keeping its pairing id, stop reason and envelope; an `image_url`
 * message becomes a user text holding the note, keeping its timestamp and origin.
 */
export function replaceInputImages(messages: readonly OmniMessage[]): OmniMessage[] {
  return messages.map((msg): OmniMessage => {
    if (!carriesImage(msg)) return msg;
    const p = msg.payload as ToolCallOutputPayload | ImageUrlPayload;
    if (p.type === "image_url") {
      return {
        ...userText(IMAGE_REMOVED_NOTE),
        timestamp: msg.timestamp,
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
      };
    }
    const { images: _images, ...rest } = p;
    const output = rest.output ? `${rest.output}\n${IMAGE_REMOVED_NOTE}` : IMAGE_REMOVED_NOTE;
    return { ...msg, payload: { ...rest, output } };
  });
}
