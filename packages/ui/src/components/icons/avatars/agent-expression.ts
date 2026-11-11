/**
 * An Agent's expression: one of a few friendly faces the ball penguin wears, chosen by the Agent's
 * id alone, as its colour is (agent-palette.ts). The same id always wears the same face — on every
 * render, after a reload, in every theme and mode — so an avatar never changes under the reader.
 *
 * The face is cut from the high sixteen bits of the id's hash, while the colour comes from the
 * hash's value modulo 360, so two Agents that share a colour can still wear different faces, and a
 * column of Agents mixes both. Every face is friendly: nothing stares, frowns or looks alarmed.
 *
 * - `bead`: two small dark bead eyes.
 * - `happy`: both eyes closed in an upward arc, ^ ^.
 * - `wink`: one bead eye, one closed arc.
 * - `smile`: bead eyes and a small smile under the beak.
 * - `sleepy`: both eyes closed in a short downward arc, relaxed.
 */
import { stableHash } from "./avatar";

export const AGENT_EXPRESSIONS = ["bead", "happy", "wink", "smile", "sleepy"] as const;

export type AgentExpression = (typeof AGENT_EXPRESSIONS)[number];

/** The expression an Agent's id wears. */
export function agentExpression(id: string): AgentExpression {
  return AGENT_EXPRESSIONS[(stableHash(id) >>> 16) % AGENT_EXPRESSIONS.length]!;
}
