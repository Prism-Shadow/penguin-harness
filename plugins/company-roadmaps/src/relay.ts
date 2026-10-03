/**
 * Who a room message is relayed to, and how deep the exchange has gone. The room sessions
 * this plugin opens all send at the organization's hop 1 — the plugin's inputs never pass the
 * scheduler's hop accounting — so the chain limit a channel's mentions obey does not stop two
 * room sessions answering each other forever. The relay keeps its own depth instead: a
 * person's message is depth 0; what an employee writes is one deeper than the last message
 * relayed to its room session; a message at `limit` is recorded but relayed to no one.
 */
import type { RoomMessage } from "./room.js";

export interface RelayPlan {
  /** The depth the message is at (null for a line that is not relayed at all: a system line). */
  depth: number | null;
  /** The employees whose room sessions receive it. */
  to: string[];
}

/**
 * The plan for one message. `depths` is, per employee, the depth of the last message relayed
 * to its room session (updated in place for every recipient); `open` the employees with an
 * open room session.
 */
export function planRelay(
  msg: RoomMessage,
  open: readonly string[],
  depths: Record<string, number>,
  limit: number,
): RelayPlan {
  if (msg.sender === "system") return { depth: null, to: [] };
  const senderAgent = msg.sender.startsWith("agent:") ? msg.sender.slice("agent:".length) : null;
  let depth: number;
  if (senderAgent === null) depth = 0;
  else if (open.includes(senderAgent)) depth = (depths[senderAgent] ?? 0) + 1;
  // An employee without a room session here — its desk, answering a mention — is as deep as
  // the organization counted it.
  else depth = msg.hop;
  if (depth >= limit) return { depth, to: [] };
  const to = open.filter((agentId) => agentId !== senderAgent);
  for (const agentId of to) depths[agentId] = depth;
  return { depth, to };
}
