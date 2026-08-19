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
  /** Deliver text, images and file attachments to the running agent as a `[user_steering]` message. */
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
  /** At least one file attachment is staged (steers as `[attached file: <path>]` lines, like a task's). */
  hasFiles: boolean;
  /**
   * The draft carries anything at all — text, images, file attachments, a staged switch chip
   * or selected skills. The queue takes a whole message, so this is its content rule.
   */
  hasContent: boolean;
}

/**
 * The button's mode while a Task runs. Idle and compacting are not this function's business:
 * a compacting Session takes its face from `isStopAction` below, and an idle one is always
 * Send, gated by the ordinary `canSend`.
 *
 * Steering is preferred over the queue when both could carry the draft, since it reaches the
 * turn already under way; the queue picks up what steering cannot — a skills-only draft, a
 * staged chip — so that "unsendable here" never costs the user Stop.
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
    (s.hasText || s.hasImages || s.hasFiles);
  if (canSteer && !s.followUpMode) return "steer";
  const canQueue = open && s.canQueueChannel && s.stagedRoute !== "blocked" && s.hasContent;
  if (canQueue) return "queue";
  // Follow-up mode with a draft the queue refuses: steering is not a silent substitute for it,
  // because the two put the message in different places. Stop, as with anything unsendable.
  return "stop";
}

/**
 * Whether the single action button wears its Stop face, for **every** session state.
 *
 * Compaction is abortable — the server takes an abort while a compaction is in flight and
 * core stops the compaction request on the signal — but the button used to ask only
 * `running && midRunAction(...) === "stop"`, and a compacting Session is not `running`. It
 * therefore fell through to the Send branch, which `canSend` disables while compacting: a
 * dead button exactly where Stop belonged, and no way to interrupt a compaction from the
 * composer at all.
 *
 * That is the same mistake this module was extracted to stop repeating (see the header): a
 * state where nothing can be sent must leave Stop, never a disabled Send. Compacting is
 * unconditionally that state — neither send channel is offered while a compaction runs, so
 * there is no draft the button could carry instead, whatever the composer holds.
 */
export function isStopAction(
  status: "idle" | "running" | "compacting",
  midRun: MidRunAction,
): boolean {
  if (status === "compacting") return true;
  return status === "running" && midRun === "stop";
}
