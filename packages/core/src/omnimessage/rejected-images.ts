/**
 * Replacing the images of an LLM request's input with a note, after the provider rejected
 * the request.
 *
 * A provider's 4xx on a request that carries an image is taken as a rejection of the image.
 * Providers word such refusals too many ways — an unsupported format, corrupt bytes, a size or
 * dimension limit, a model that takes no images, an oversized screenshot reported as an
 * "unsupported image" — for the harness to read a cause out of them, so it reads none: the
 * note says the request was refused while it carried the image and quotes the provider's
 * text as it came, and the model judges for itself what went wrong. While the image stays in
 * a turn's input every request carrying it fails the same way, so the engine swaps every image
 * in the turn's input for the note and retries; Trace replay applies the same swap to the
 * rejected attempt's input, so a resumed Session's history matches the one the process had.
 * The note is built from the provider's text alone, recorded as `request_end.error_message`,
 * so both sides produce the same text from the Trace.
 *
 * Pure: new messages are built and the originals are never mutated — the Trace and the
 * render view keep showing the image as it was sent.
 */
import { userText } from "./builders.js";
import type { ImageUrlPayload, OmniMessage, ToolCallOutputPayload } from "./types.js";

/**
 * The text that stands in for a rejected image: what happened, and the provider's own words
 * when the request ended with any. It names no cause and states no limit — the harness does
 * not know why the provider refused, and the model reads the provider's text itself.
 */
export function rejectedImageNote(providerError?: string): string {
  const text = providerError?.trim();
  const quoted = text ? ` Provider error: ${text}` : "";
  return (
    "[image not sent: the current model rejected the request while it carried this image, " +
    `so the request was sent again without the image.${quoted}]`
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
 * Every image in `messages` replaced by {@link rejectedImageNote}; messages without images
 * are returned as-is (the same object). A tool output loses `images` and gets the note
 * appended to its text, keeping its pairing id, stop reason and envelope; an `image_url`
 * message becomes a user text holding the note, keeping its timestamp and origin.
 * `providerError` is the rejected request's error text (`LLMOutcome.errorMessage`, recorded as
 * `request_end.error_message`), quoted in the note.
 */
export function replaceInputImages(
  messages: readonly OmniMessage[],
  providerError?: string,
): OmniMessage[] {
  const note = rejectedImageNote(providerError);
  return messages.map((msg): OmniMessage => {
    if (!carriesImage(msg)) return msg;
    const p = msg.payload as ToolCallOutputPayload | ImageUrlPayload;
    if (p.type === "image_url") {
      return {
        ...userText(note),
        timestamp: msg.timestamp,
        ...(msg.origin !== undefined ? { origin: msg.origin } : {}),
      };
    }
    const { images: _images, ...rest } = p;
    const output = rest.output ? `${rest.output}\n${note}` : note;
    return { ...msg, payload: { ...rest, output } };
  });
}
