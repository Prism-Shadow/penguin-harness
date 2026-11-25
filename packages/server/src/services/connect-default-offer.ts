/**
 * Saving a group key offers a model of that group as the Project's default model: the group's
 * catalog `connectDefault` when it declares one (TokenDance, Penguin Go: their DeepSeek V4.1
 * Flash), else the group's first chat-eligible model in the Project's table. This module is the
 * rule; the writes that store a group key apply it to the table they are about to write
 * (project-config-service.ts) and report the offer, and the page asks the user. The default
 * itself is never written here: it moves only when the user accepts, through the ordinary
 * default-model write.
 *
 * - Every write that stores a group key counts, whether from its connect flow or typed into its
 *   group settings (including replacing a stored key by hand). A group settings write that leaves
 *   the key untouched offers nothing.
 * - Only a default outside the group is worth asking about: a Project whose default is any model
 *   of this group already uses it, and is left alone. A Project with no default is offered one.
 * - The table must hold the row before the key lands: one the user deleted, or a group with no
 *   chat-eligible row, offers nothing, even when the write that brings the key adds it (Penguin
 *   Go's delivery adds the models its group lacks).
 */
import { providerInfo } from "../model-catalog/catalog.js";
import type { DefaultModelOffer } from "../api/types.js";
import type { ModelRefDto } from "@prismshadow/penguin-library-agent-api";

/** What the rule reads of one write: the group, its key before and after, and the rows before. */
export interface ConnectDefaultFacts {
  provider: string;
  /** The group held a key of its own before the write. */
  hadKey: boolean;
  /** It holds one after. */
  hasKey: boolean;
  /** Whether the write itself set a group key (including replacing a stored one). */
  wroteKey?: boolean;
  /** The default the Project stores, which the write leaves as it is. */
  current: ModelRefDto | undefined;
  /** Whether the table held this group's row with that model id before the write. */
  holds: (modelId: string) => boolean;
  /** The group's first chat-eligible model id in the table before the write, when the catalog names no connectDefault. */
  firstChatModelId?: string | undefined;
}

/** The default this write offers, or undefined when it offers none. */
export function connectDefaultOffer(facts: ConnectDefaultFacts): DefaultModelOffer | undefined {
  const keyLanded = facts.wroteKey ?? (!facts.hadKey && facts.hasKey);
  if (!keyLanded || !facts.hasKey) {
    return undefined;
  }
  const connectDefault = providerInfo(facts.provider)?.connectDefault;
  const modelId =
    connectDefault !== undefined
      ? facts.holds(connectDefault)
        ? connectDefault
        : undefined
      : facts.firstChatModelId !== undefined && facts.holds(facts.firstChatModelId)
        ? facts.firstChatModelId
        : undefined;
  if (modelId === undefined) {
    return undefined;
  }
  const { current } = facts;
  if (current?.provider === facts.provider) return undefined;
  return {
    model: { provider: facts.provider, modelId },
    ...(current !== undefined ? { current } : {}),
  };
}
