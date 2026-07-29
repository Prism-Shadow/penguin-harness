/**
 * What the composer's single action button does while a Task is running.
 *
 * Pulled out of ChatInput for the same reason as `stagedSendRoute`: the decision has more
 * inputs than it looks (two send channels, a mode toggle, a staged switch, a dead model key,
 * a goal draft) and every one of them can take a channel away. Inline, that made a specific
 * mistake easy to repeat — deriving Stop from "is the composer empty" instead of "does this
 * send have anywhere to go". Those agree only while every non-empty draft is sendable, and
 * several are not: a goal objective is an objective rather than a message for the turn under
 * way, a rejected model key refuses everything, and a staged `/model` fork waits for idle.
 * Where they disagreed the button showed a permanently disabled Send *in place of* Stop, so
 * the run could not be sent to or stopped without emptying the composer first.
 *
 * Stop is therefore the fallthrough here, not a case: whatever cannot be sent leaves Stop.
 */
export type MidRunAction =
  /** Abort the running Task — the button's face whenever this draft has no send channel. */
  | "stop"
  /** Deliver text and images to the running agent as a `[user_steering]` message. */
  | "steer"
  /** Hold the whole draft server-side and auto-send it as the next ordinary message. */
  | "queue"
  /** A send of this draft is already in flight; the button is inert until it settles. */
  | "disabled";

export interface MidRunComposerState {
  /** A send started from this composer is in flight (ChatInput's `busy`). */
  sending: boolean;
  /** The goal chip is engaged: the body is an objective, which no mid-run channel carries. */
  goalOn: boolean;
  /** The model API rejected this Session's credentials — nothing can be sent at all. */
  modelAuthDead: boolean;
  /** The host wired a steer channel (`onSteer`); the draft page does not. */
  canSteerChannel: boolean;
  /** The host wired a follow-up queue (`onQueueFollowUp`); the draft page does not. */
  canQueueChannel: boolean;
  /** Mid-run send mode is "follow-up" rather than "steer" (remembered per user). */
  followUpMode: boolean;
  /** Where a staged `/agent` / `/model` chip would send this (see stagedSendRoute). */
  stagedRoute: "post" | "handoff" | "model" | "blocked";
  /** An `/agent` handoff target is staged. */
  hasHandoffTarget: boolean;
  /** A `/model` fork target is staged. */
  hasPendingModel: boolean;
  /** The body has non-whitespace text. */
  hasText: boolean;
  /** At least one image is attached. */
  hasImages: boolean;
  /**
   * The draft carries anything at all — text, images, file attachments, a staged switch chip
   * or selected skills. The queue takes a whole message, so this is its content rule.
   */
  hasContent: boolean;
}

/**
 * The button's mode while a Task runs. Idle and compacting are not this function's business:
 * the button is always Send there, gated by the ordinary `canSend`.
 *
 * Steering is preferred over the queue when both could carry the draft, since it reaches the
 * turn already under way; the queue picks up what steering cannot — a skills-only draft, file
 * attachments, a staged chip — so that "unsendable here" never costs the user Stop.
 */
export function midRunAction(s: MidRunComposerState): MidRunAction {
  if (s.sending) return "disabled";
  // A goal draft and a dead key close both channels; a blocked `/model` fork closes the queue
  // (see stagedSendRoute) and cannot reach steering anyway, since a staged chip rules it out.
  const open = !s.goalOn && !s.modelAuthDead;
  const canSteer =
    open &&
    s.canSteerChannel &&
    !s.hasHandoffTarget &&
    !s.hasPendingModel &&
    (s.hasText || s.hasImages);
  if (canSteer && !s.followUpMode) return "steer";
  const canQueue = open && s.canQueueChannel && s.stagedRoute !== "blocked" && s.hasContent;
  if (canQueue) return "queue";
  // Follow-up mode with a draft the queue refuses: steering is not a silent substitute for it,
  // because the two put the message in different places. Stop, as with anything unsendable.
  return "stop";
}
