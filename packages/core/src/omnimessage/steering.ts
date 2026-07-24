/**
 * `[user_steering]` blocks — mid-run user messages riding on tool output.
 *
 * While a Task is running, the user can send a steering message
 * (`Session.steer`): the engine appends it to the next completed
 * `tool_call_output`'s `output` as a `[user_steering]…[/user_steering]` block, so the model
 * sees it with the tool result **without interrupting the agent loop**. The block is part of
 * the persisted output (Trace) and of the streamed complete message; render layers (Web tool
 * card, CLI gutter) use `splitUserSteering` to show it as user speech instead of raw markers.
 */

/** Formats one queued steering message as the block appended to a tool output (leading blank line separates it from the tool's own output). */
export function userSteeringBlock(text: string): string {
  return `\n\n[user_steering]\n${text}\n[/user_steering]`;
}

/** One segment of a tool output: the tool's own output text, or an appended steering message (marker stripped). */
export interface ToolOutputSegment {
  kind: "output" | "steering";
  text: string;
}

/** Matches an appended `[user_steering]` block (with the blank-line separator emitted by userSteeringBlock, tolerated if absent). */
const STEERING_BLOCK_RE = /\n?\n?\[user_steering\]\n([\s\S]*?)\n\[\/user_steering\]/g;

/**
 * Splits a tool output into ordinary output and the `[user_steering]` blocks appended to it,
 * in order. An output without steering yields a single `output` segment (empty output yields
 * no segments); render layers show `steering` segments as user speech.
 */
export function splitUserSteering(output: string): ToolOutputSegment[] {
  const segments: ToolOutputSegment[] = [];
  let last = 0;
  STEERING_BLOCK_RE.lastIndex = 0;
  for (let m = STEERING_BLOCK_RE.exec(output); m !== null; m = STEERING_BLOCK_RE.exec(output)) {
    const before = output.slice(last, m.index);
    if (before) segments.push({ kind: "output", text: before });
    segments.push({ kind: "steering", text: m[1]! });
    last = m.index + m[0].length;
  }
  const rest = output.slice(last);
  if (rest) segments.push({ kind: "output", text: rest });
  return segments;
}
