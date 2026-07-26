/**
 * `[user_steering]` — mid-run user messages delivered between turns.
 *
 * While a Task is running, the user can send a steering message (`Session.steer`): the engine
 * queues it and delivers it as a **standalone user text message** wrapped in a
 * `[user_steering]…[/user_steering]` block, sent with the next request input alongside that
 * turn's tool outputs (or as the continuation input when the turn produced no tool calls) —
 * the model sees it without the agent loop being interrupted. The message is real user input:
 * written to Trace like any Prompt and yielded to the output stream. The marker exists so the
 * model and the render layers can tell it apart from a task-starting Prompt: UIs keep it inside
 * the running Task (no new Task segment) and render it as user speech instead of raw markers.
 *
 * Unlike the other markers this one has **no legacy angle form** to accept: it was introduced
 * after the square-bracket convention, so no Trace can contain `<user_steering>`.
 */
import { markerBlock } from "./block.js";
import { MARKER_TAGS } from "./tags.js";

/** Wraps one queued steering message as the standalone user-text body sent to the model. */
export function userSteeringText(text: string): string {
  return markerBlock(MARKER_TAGS.userSteering, text);
}

/** Matches a whole user text that is exactly one `[user_steering]` block (square form only, see the module note). */
const STEERING_TEXT_RE = new RegExp(
  `^\\[${MARKER_TAGS.userSteering}\\]\\n([\\s\\S]*?)\\n\\[/${MARKER_TAGS.userSteering}\\]\\s*$`,
);

/**
 * Inverse of `userSteeringText`: when the whole user text is one `[user_steering]` block,
 * returns the inner message; otherwise null (a normal user message — including one merely
 * mentioning the marker mid-body — is left alone). Used by task segmentation (a steering
 * message must not start a new Task) and by the Web/CLI steering rendering.
 */
export function parseUserSteeringText(text: string): string | null {
  const m = STEERING_TEXT_RE.exec(text);
  return m ? m[1]! : null;
}
