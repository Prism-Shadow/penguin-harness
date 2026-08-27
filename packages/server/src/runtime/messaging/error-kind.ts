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
 * errors and raises a to-do badge on their count, so a channel that files its ordinary refusals
 * there produces a red dot pointing at nothing anyone can fix — and buries the failures that
 * genuinely do need looking at.
 *
 * The rule is deliberately a small allowlist of TYPED failures rather than a message match.
 * Anything the connectors have not classified stays `unexpected`, which is the safe direction:
 * a real fault miscounted as routine is invisible, while routine noise miscounted as a fault is
 * merely loud.
 */
import type { ErrorKind } from "../error-recorder.js";
import {
  MessagingMediaTooLargeError,
  MessagingPermissionError,
  MessagingUnsupportedError,
} from "./media.js";

/**
 * How one messaging failure should be filed.
 *
 * The three expected cases, and why each is one:
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
 * and keeps its place on the dashboard.
 */
export function messagingErrorKind(err: unknown): ErrorKind {
  if (
    err instanceof MessagingPermissionError ||
    err instanceof MessagingMediaTooLargeError ||
    err instanceof MessagingUnsupportedError
  ) {
    return "expected";
  }
  return "unexpected";
}
