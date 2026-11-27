/**
 * The recall store derived from a message's input records — what a queued follow-up hands
 * back to the composer when the user withdraws it (services+http+cli restack S8; was the
 * session manager's). The session contract owns the shape; this derives it from input.
 *
 * `files` is empty because the path a written attachment landed on is known only to
 * whoever wrote it. A caller that wrote some therefore builds its store on top of this one
 * instead of leaving it to be derived, and passes the input as it stood BEFORE the
 * `[attached file: …]` lines were folded in — derived from the folded input, `text` would
 * hand a recall back a raw scratchpad path in place of the chip it was meant to restore.
 */
import type { AmspRecord, TextPayload } from "@prismshadow/penguin-core";
import type { RecallStore } from "@prismshadow/penguin-library-session";

/** Predicate for a plain-text message (no origin): recall and title material are drawn only from the role's model text. */
export function isPlainText(role: "user" | "assistant") {
  return (msg: AmspRecord): msg is AmspRecord<TextPayload> => {
    const payload = msg.payload as { type?: string; role?: string };
    return (
      msg.type === "model_msg" &&
      payload.type === "text" &&
      payload.role === role &&
      (!msg.origin || msg.origin.length === 0)
    );
  };
}

export function recallStoreOf(input: AmspRecord[]): RecallStore {
  const text = input
    .filter(isPlainText("user"))
    .map((m) => m.payload.text)
    .join("\n");
  const images: string[] = [];
  for (const msg of input) {
    const payload = msg.payload as { type?: string; image_url?: unknown };
    if (
      msg.type === "model_msg" &&
      payload.type === "image_url" &&
      typeof payload.image_url === "string"
    ) {
      images.push(payload.image_url);
    }
  }
  return { text, images, files: [] };
}
