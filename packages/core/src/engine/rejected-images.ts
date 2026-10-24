/**
 * Replacing the images of an LLM request's input with a fixed note, after the provider
 * rejected the request.
 *
 * A provider's 4xx on a request that carries an image is taken as a rejection of the image.
 * Providers word such refusals too many ways — an unsupported format, corrupt bytes, a size or
 * dimension limit, a model that takes no images, an oversized screenshot reported as an
 * "unsupported image" — for the harness to read a cause out of them, so it reads none. While
 * the image stays in a turn's input every request carrying it fails the same way, so the
 * engine swaps every image in the turn's input for the note and retries; the provider's own
 * words reach the model through the `[request_error]` line of that retry's `[turn_retried]`
 * block (see markers/engine-blocks.ts), where every retried failure's text goes. Trace replay
 * applies the same swap to the rejected attempt's input, so a resumed Session's history
 * matches the one the process had; the note is a constant, so both sides agree from the Trace
 * alone.
 *
 * Pure: new messages are built and the originals are never mutated — the Trace and the
 * render view keep showing the image as it was sent.
 */
import { userText } from "@prismshadow/amsp/records";
import type { ImageUrlPayload, AmspRecord, ToolCallOutputPayload } from "@prismshadow/amsp/records";

/**
 * The text that stands in for a rejected image: what happened, and nothing the harness would
 * have to guess — no cause, no limit. The provider's error text rides in the retry's
 * `[request_error]` line, once, not in every note.
 */
export const REJECTED_IMAGE_NOTE =
  "[image not sent: the current model rejected the request while it carried this image, " +
  "so the request was sent again without the image.]";

/** Whether a message carries an image: a tool output with `images`, or an `image_url` message. */
function carriesImage(msg: AmspRecord): boolean {
  const p = msg.payload as { type?: string; images?: unknown };
  if (p.type === "image_url") return true;
  return p.type === "tool_call_output" && Array.isArray(p.images) && p.images.length > 0;
}

/** Whether any message of a request's input carries an image (see {@link replaceInputImages}). */
export function hasInputImages(messages: readonly AmspRecord[]): boolean {
  return messages.some(carriesImage);
}

/**
 * Every image in `messages` replaced by {@link REJECTED_IMAGE_NOTE}; messages without images
 * are returned as-is (the same object). A tool output loses `images` and gets the note
 * appended to its text, keeping its pairing id, stop reason and envelope; an `image_url`
 * message becomes a user text holding the note, keeping its timestamp and origin.
 */
export function replaceInputImages(messages: readonly AmspRecord[]): AmspRecord[] {
  return messages.map((msg): AmspRecord => {
    if (!carriesImage(msg)) return msg;
    const p = msg.payload as ToolCallOutputPayload | ImageUrlPayload;
    if (p.type === "image_url") {
      return {
        ...userText(REJECTED_IMAGE_NOTE),
        timestamp: msg.timestamp,
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
      };
    }
    const { images: _images, ...rest } = p;
    const output = rest.output ? `${rest.output}\n${REJECTED_IMAGE_NOTE}` : REJECTED_IMAGE_NOTE;
    return { ...msg, payload: { ...rest, output } };
  });
}
