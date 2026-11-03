/**
 * What a reply's read-only blocks read: the message that answered it.
 *
 * A pick or a submit in a reply's choice or form fills the composer, and the reader sends that
 * text as an ordinary message. So the answers to a question are already on record, in the
 * message that followed its reply, and the blocks read them back from there (the UI package
 * parses the text against each block) — after a reload, an answered form shows what the reader
 * answered, not the model's defaults, with nothing stored besides the transcript.
 *
 * Each reply is handed the text of the first message the person wrote after it, as the
 * transcript reads it: a prompt's own words with its source blocks and attachment lines taken
 * off (`parseUserMessageBody`), or a steer's. What the harness fed in — a goal round, a hook's
 * continue, a scheduled or an organization trigger, a background completion — is not an answer
 * and is passed over. A reply with no message after it gets none.
 *
 * Kept free of React (test/a2ui-answered.test.ts); the transcript hands the result out in
 * MessageItems, alongside the open question's actions (a2ui-reply.ts).
 */
import type { A2uiActions } from "@prismshadow/penguin-ui";
import { splitAttachments } from "../../lib/attachments";
import type { ChatItem } from "../../lib/amsp/stream-model";
import { parseUserMessageBody } from "./user-message-body";

/** The fill of every reply whose blocks do not take input, where picking is disabled anyway. */
const NO_FILL = (): void => {};

/** The words a person wrote in this item, or undefined when it is not a message of theirs. */
function writtenText(item: ChatItem): string | undefined {
  if (item.kind === "user_steering") return splitAttachments(item.text).text.trim();
  // An image the person sent with no text: their message, with no words to answer in.
  if (item.kind === "user_image") return "";
  if (item.kind !== "user_text" || item.sender === "harness") return undefined;
  const body = parseUserMessageBody(item.text);
  if (body === null || body.scheduled || body.orgTrigger === true || body.backgroundDone === true) {
    return undefined;
  }
  return body.body;
}

/**
 * The text of the message that answered each reply, by the reply's item id: the first message
 * the person wrote after it. One pass from the end, carrying the latest such message back.
 */
export function replyAnswers(items: readonly ChatItem[]): ReadonlyMap<number, string> {
  const out = new Map<number, string>();
  let next: string | undefined;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i]!;
    if (item.kind === "assistant_text") {
      if (next !== undefined) out.set(item.id, next);
      continue;
    }
    // A prompt's images arrive behind its text, so going back the text is the one that stays.
    next = writtenText(item) ?? next;
  }
  return out;
}

/**
 * Every reply's read-only actions, by item id: input off, the interface language, and the
 * message that answered it. A reply whose language and answer are what they were in `previous`
 * keeps that object, so a stream frame that changes neither hands every block the value it
 * already holds — the blocks read it through context, past the memoized Markdown, and a fresh
 * object would re-render each of them.
 */
export function readOnlyActions(
  previous: ReadonlyMap<number, A2uiActions>,
  items: readonly ChatItem[],
  lang: A2uiActions["lang"],
): ReadonlyMap<number, A2uiActions> {
  const answers = replyAnswers(items);
  const out = new Map<number, A2uiActions>();
  for (const item of items) {
    if (item.kind !== "assistant_text") continue;
    const answeredWith = answers.get(item.id);
    const kept = previous.get(item.id);
    out.set(
      item.id,
      kept !== undefined && kept.lang === lang && kept.answeredWith === answeredWith
        ? kept
        : {
            interactive: false,
            fill: NO_FILL,
            lang,
            ...(answeredWith !== undefined ? { answeredWith } : {}),
          },
    );
  }
  return out;
}
