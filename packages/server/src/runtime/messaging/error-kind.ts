/**
 * Which messaging failures need a human, and which are the system working as designed.
 *
 * Every failure the bridge catches used to reach `error-recorder.ts` with no `kind`, and its
 * default for a non-HTTP source is `unexpected` — so an inbound picture a Feishu app had simply
 * not been granted the scope to download, and a file QQ structurally cannot accept, both filed
 * as "shouldn't happen, needs a human". They are neither. The recorder's own criterion is
 * **"does a human need to step in"**, not "did something fail", and by that rule a refusal is
 * `expected` when it is anticipated, has a defined handling path, and leaves nobody anything to
 * do: the one person who can act has already been told, in the chat, exactly what to do — or
 * there is nothing anyone could do at all.
 *
 * That distinction is load-bearing rather than cosmetic. The cost center highlights unexpected
 * errors, so a channel that files its ordinary refusals there points that highlight at nothing
 * anyone can fix — and buries the failures that genuinely do need looking at.
 *
 * It takes the capture point's `code` as well as the error, because the type alone cannot
 * answer the question: it says what went wrong, not whether anyone was told. Feishu throws the
 * SAME scope denial (code 99991672) from every call — the inbound image download, the outbound
 * upload, and the plain text send — and only the first is followed by a notice into the chat.
 * The other two tell the chat nothing: a reply's file that did not go out is said in its error
 * record and nowhere else, and on a text send there is nothing to be told with at all, because
 * the message that would carry the notice is the message being refused. An app granted
 * "receive" but not `im:message:send_as_bot` then receives every question and answers none of
 * them, silently, which is the worst state this feature has — and this record is the only place
 * it surfaces.
 *
 * The rule is deliberately a small allowlist of TYPED failures at NAMED capture points rather
 * than a message match, plus one typed failure that arrives carrying its own verdict — a
 * connection the platform closed, where whether anything stayed broken is protocol state only
 * the connector holds. Anything the connectors have not classified stays `unexpected`, which
 * is the safe direction: a real fault miscounted as routine is invisible, while routine noise
 * miscounted as a fault is merely loud.
 */
import type { ErrorKind } from "../error-recorder.js";
import {
  MessagingMediaTooLargeError,
  MessagingOutboundCapError,
  MessagingPermissionError,
  MessagingUnsupportedError,
} from "./media.js";
import { MessagingConnectionClosedError } from "./qq-api.js";

/**
 * The capture points that put the refusal in front of the person in the chat.
 *
 * `messaging_image_fetch_failed` and `messaging_file_fetch_failed` answer the sender in the
 * chat it came from (see messagingImagePermissionNotice and its siblings). Every other code
 * fails with the chat hearing nothing at all — a reply that never went out, a reply's file that
 * did not (see ROUTINE_OUTBOUND_FILE_REFUSALS), an inbound message whose Task never started, a
 * connection that will not come up — so the dashboard is where it has to be noticed.
 *
 * A Markdown send the channel refuses adds no code here, and that is deliberate. The
 * connector retries it as plain text (see the three renderers' fallback), so the ordinary
 * outcome is a DELIVERED message and nothing is recorded at all — there is no failure to
 * file and nothing to tell anyone. Only a send that then fails on its own terms records
 * anything, as `messaging_send_failed`, and that code stays out of this set for the reason
 * every other send failure does: the message that would have carried the explanation is the
 * message that did not go out.
 */
const CODES_EXPLAINED_IN_CHAT = new Set([
  "messaging_image_fetch_failed",
  "messaging_file_fetch_failed",
]);

/** A typed refusal's class, as `instanceof` takes it. */
type RefusalType = new (message: string) => Error;

/**
 * The outbound file capture points, each with the one type it files as routine.
 *
 * The chat is told nothing at any of them — a reply's files that did not go out are recorded and
 * never posted (see the bridge's messagingFilesNotSentRecords) — so `expected` here cannot mean
 * "the person who can act was told". It means nobody has anything to do:
 *
 * - `messaging_file_send_failed` + {@link MessagingUnsupportedError} — the channel structurally
 *   cannot carry a file (QQ's rich-media path needs a publicly reachable URL this server does
 *   not have). It will refuse the next one identically; there is no fault to chase and no fix
 *   to deploy.
 * - `messaging_file_too_large` and `messaging_files_skipped` + {@link MessagingOutboundCapError}
 *   — the bridge's own per-file ceiling and per-reply count. Known limits: nothing is broken,
 *   and the Web App still has every file.
 *
 * A missing permission on an upload is deliberately NOT routine. The same
 * {@link MessagingPermissionError} is `expected` on an inbound download, where the chat is
 * handed the scope names and the console link; on an upload nobody is handed anything, so a
 * human still has to grant the scope and this record is the only place that says so. Every
 * other upload failure stays `unexpected` with it.
 */
const ROUTINE_OUTBOUND_FILE_REFUSALS: ReadonlyMap<string, RefusalType> = new Map([
  ["messaging_file_send_failed", MessagingUnsupportedError],
  ["messaging_file_too_large", MessagingOutboundCapError],
  ["messaging_files_skipped", MessagingOutboundCapError],
]);

/**
 * How one messaging failure should be filed.
 *
 * `expected` needs both halves: a failure this code understands, caught at a capture point
 * where that failure leaves nobody anything to do. At the two inbound downloads, three types
 * are understood, and why each is one:
 *
 * - {@link MessagingPermissionError} — the channel refused because the bot's app lacks a scope.
 *   The chat receives the scope names and the console link, so the person who can fix it has
 *   already been handed the fix; an operator reading the dashboard can do nothing this notice
 *   has not already done.
 * - {@link MessagingMediaTooLargeError} — a transfer over the cap. The sender fixes it by
 *   sending something smaller, and the chat says so. Nothing is broken.
 * - {@link MessagingUnsupportedError} — the channel structurally cannot carry this, and says
 *   why. It will refuse the next one identically; there is no fault to chase and no fix to
 *   deploy, so recording it as a defect would only teach people to ignore the count.
 *
 * The outbound file capture points understand less, for the reason
 * ROUTINE_OUTBOUND_FILE_REFUSALS gives: the structural refusal and the bridge's own caps, and
 * never a missing permission.
 *
 * Everything else — a network failure, a 5xx from the platform, a bug here — is `unexpected`
 * and keeps its place on the dashboard, and so is any understood type caught anywhere not named
 * above: a refusal nobody was told about, and that somebody could still fix, is a refusal
 * somebody has to notice.
 *
 * {@link MessagingConnectionClosedError} is classified wherever it is caught, and answers the
 * criterion from its own verdict rather than a capture point: nobody needs telling, because
 * nothing stayed broken. A platform that expires a long-lived socket, or hits its own internal
 * error, is answered by the connector's next handshake within the backoff, and the only trace
 * is a record nobody can act on. It is `expected` only when the connector says the close is one
 * of those — `recovers` is decided where the reconnect is, and a close that leaves the binding
 * down until a credential or a console setting changes reports `recovers: false` and stays a
 * defect.
 */
export function messagingErrorKind(err: unknown, code: string): ErrorKind {
  if (err instanceof MessagingConnectionClosedError) {
    return err.recovers ? "expected" : "unexpected";
  }
  if (CODES_EXPLAINED_IN_CHAT.has(code)) {
    return err instanceof MessagingPermissionError ||
      err instanceof MessagingMediaTooLargeError ||
      err instanceof MessagingUnsupportedError
      ? "expected"
      : "unexpected";
  }
  const routine = ROUTINE_OUTBOUND_FILE_REFUSALS.get(code);
  return routine !== undefined && err instanceof routine ? "expected" : "unexpected";
}
