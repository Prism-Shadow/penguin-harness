/**
 * Which messaging failures need a human, and which are the system working as designed.
 *
 * Every failure the bridge catches used to reach `error-recorder.ts` with no `kind`, and its
 * default for a non-HTTP source is `unexpected` — so a Feishu app that has simply not been
 * granted a scope yet, and a file QQ structurally cannot accept, both filed as "shouldn't
 * happen, needs a human". They are neither. The recorder's own criterion is **"does a human
 * need to step in"**, not "did something fail", and by that rule these are `expected`: they
 * are anticipated, they have a defined handling path, and the path ends with the one person
 * who can act already being told, in the chat, exactly what to do.
 *
 * That distinction is load-bearing rather than cosmetic. The cost center highlights unexpected
 * errors, so a channel that files its ordinary refusals there points that highlight at nothing
 * anyone can fix — and buries the failures that genuinely do need looking at.
 *
 * It takes the capture point's `code` as well as the error, because the type alone cannot
 * answer the question: it says what went wrong, not whether anyone was told. Feishu throws the
 * SAME scope denial (code 99991672) from every call — the inbound image download, the outbound
 * upload, and the plain text send — and only the first two are followed by a notice into the
 * chat. On a text send there is nothing to be told with: the message that would carry the
 * notice is the message being refused. An app granted "receive" but not `im:message:send_as_bot`
 * then receives every question and answers none of them, silently, which is the worst state
 * this feature has — and this record is the only place it surfaces.
 *
 * The rule is deliberately a small allowlist of TYPED failures at NAMED capture points rather
 * than a message match. Anything the connectors have not classified stays `unexpected`, which
 * is the safe direction: a real fault miscounted as routine is invisible, while routine noise
 * miscounted as a fault is merely loud.
 */
import type { ErrorKind } from "../error-recorder.js";
import {
  MessagingMediaTooLargeError,
  MessagingPermissionError,
  MessagingUnsupportedError,
} from "./media.js";

/**
 * The capture points that put the refusal in front of the person in the chat.
 *
 * `messaging_image_fetch_failed` answers the sender in the chat it came from (see
 * messagingImagePermissionNotice and its siblings), and `messaging_file_send_failed` names the
 * file that did not make it and why (see noteFileFailure). Every other code fails with the chat
 * hearing nothing at all — a reply that never went out, an inbound message whose Task never
 * started, a connection that will not come up — so the dashboard is where it has to be noticed.
 */
const CODES_EXPLAINED_IN_CHAT = new Set([
  "messaging_image_fetch_failed",
  "messaging_file_send_failed",
]);

/**
 * How one messaging failure should be filed.
 *
 * `expected` needs both halves: a failure this code understands, caught somewhere the chat is
 * told about it. The three understood types, and why each is one:
 *
 * - {@link MessagingPermissionError} — the channel refused because the bot's app lacks a scope.
 *   The chat receives the scope names and the console link to grant them, so the person who
 *   can fix it has already been handed the fix; an operator reading the dashboard can do
 *   nothing this notice has not already done.
 * - {@link MessagingMediaTooLargeError} — a transfer over the cap. The sender fixes it by
 *   sending something smaller, and the chat says so. Nothing is broken.
 * - {@link MessagingUnsupportedError} — the channel structurally cannot carry this, and says
 *   why. It will refuse the next one identically; there is no fault to chase and no fix to
 *   deploy, so recording it as a defect would only teach people to ignore the count.
 *
 * Everything else — a network failure, a 5xx from the platform, a bug here — is `unexpected`
 * and keeps its place on the dashboard, and so is any of the three caught where the chat hears
 * nothing: a refusal nobody was told about is still a refusal somebody has to notice.
 */
export function messagingErrorKind(err: unknown, code: string): ErrorKind {
  if (!CODES_EXPLAINED_IN_CHAT.has(code)) return "unexpected";
  if (
    err instanceof MessagingPermissionError ||
    err instanceof MessagingMediaTooLargeError ||
    err instanceof MessagingUnsupportedError
  ) {
    return "expected";
  }
  return "unexpected";
}
