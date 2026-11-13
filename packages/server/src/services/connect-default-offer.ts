/**
 * Connecting a group that names a connect default (TokenDance, Penguin Go: their DeepSeek V4.1
 * Flash) offers that model as the Project's default model. This module is the rule; the writes
 * that store a group key apply it to the table they are about to write (project-config-service.ts)
 * and report the offer, and the page asks the user. The default itself is never written here: it
 * moves only when the user accepts, through the ordinary default-model write.
 *
 * - Only the transition counts: the group held no key of its own before the write and holds one
 *   after, whether from its connect flow or typed into its group settings. Reconnecting a
 *   connected group, and every group that names no connect default, offer nothing.
 * - Only a default outside the group is worth asking about: a Project whose default is any model
 *   of this group already uses it, and is left alone. A Project with no default is offered one.
 * - The table must hold the row before the key lands: one the user deleted, or one the catalog
 *   no longer seeds, offers nothing, even when the write that brings the key adds it (Penguin
 *   Go's delivery adds the models its group lacks).
 */
import { providerInfo } from "../model-catalog/catalog.js";
import type { DefaultModelOffer, ModelRefDto } from "../api/types.js";

/** What the rule reads of one write: the group, its key before and after, and the rows before. */
export interface ConnectDefaultFacts {
  provider: string;
  /** The group held a key of its own before the write. */
  hadKey: boolean;
  /** It holds one after. */
  hasKey: boolean;
  /** The default the Project stores, which the write leaves as it is. */
  current: ModelRefDto | undefined;
  /** Whether the table held this group's row with that model id before the write. */
  holds: (modelId: string) => boolean;
}

/** The default this write offers, or undefined when it offers none. */
export function connectDefaultOffer(facts: ConnectDefaultFacts): DefaultModelOffer | undefined {
  const modelId = providerInfo(facts.provider)?.connectDefault;
  if (modelId === undefined || facts.hadKey || !facts.hasKey || !facts.holds(modelId)) {
    return undefined;
  }
  const { current } = facts;
  if (current?.provider === facts.provider) return undefined;
  return {
    model: { provider: facts.provider, modelId },
    ...(current !== undefined ? { current } : {}),
  };
}
