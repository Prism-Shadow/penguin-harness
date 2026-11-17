/**
 * What an Agent's default avatar wears: one of a small closed set, chosen by the Agent's id alone.
 *
 * Twelve colours leave two Agents in a list of a dozen sharing one, so the mascot also wears
 * something, or nothing: a second thing to tell two Agents apart by, at a glance, that needs no
 * stored field and survives renames, themes and modes exactly as the colour does.
 *
 * The pick is the quotient of the id's hash by 360, where the colour is its remainder
 * (`avatarHue`): the two parts of one number vary independently, so every colour meets every
 * accessory, and ids that differ in their last character, which land on few colours, still
 * spread over the whole set. The order is part of the rule: an id keeps its accessory only while
 * the list keeps its order and length, so a new accessory is a visible change for existing Agents.
 */
import { avatarHash } from "./avatar";

/** The set, in pick order; `none` is the mascot as it is, with its tuft. */
export const AGENT_ACCESSORIES = [
  "none",
  "scarf",
  "beanie",
  "cap",
  "headphones",
  "sprout",
  "bow",
  "glasses",
] as const;

export type AgentAccessory = (typeof AGENT_ACCESSORIES)[number];

/** What an Agent wears, from its id. */
export function agentAccessory(id: string): AgentAccessory {
  return AGENT_ACCESSORIES[Math.floor(avatarHash(id) / 360) % AGENT_ACCESSORIES.length]!;
}
