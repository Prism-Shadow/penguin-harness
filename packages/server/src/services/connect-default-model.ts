/**
 * Connecting a group that names a connect default (TokenDance, Penguin Go: their DeepSeek V4.1
 * Flash) makes that model the Project's default model. This module is the rule; the writes that
 * store a group key apply it to the table they are about to write (project-config-service.ts),
 * so the default moves in the same file write as the key, however the browser that asked for it
 * fares afterwards.
 *
 * - Only the transition counts: the group held no key of its own before the write and holds one
 *   after, whether from its connect flow or typed into its group settings. Reconnecting a
 *   connected group, and every group that names no connect default, move nothing.
 * - It replaces whatever default the Project had, and reports that one, so the page can offer
 *   to put it back.
 * - The table must hold the row before the key lands: one the user deleted, or one the catalog
 *   no longer seeds, moves nothing and reports nothing, even when the write that brings the key
 *   adds it (Penguin Go's delivery adds the models its group lacks). Nor does a default that
 *   already is it.
 */
import { providerInfo } from "../model-catalog/catalog.js";
import type { DefaultModelSwitch, ModelRefDto } from "../api/types.js";

/** What the rule reads of one write: the group, its key before and after, and the rows before. */
export interface ConnectDefaultFacts {
  provider: string;
  /** The group held a key of its own before the write. */
  hadKey: boolean;
  /** It holds one after. */
  hasKey: boolean;
  /** The default the Project stored before the write, if any. */
  previous: ModelRefDto | undefined;
  /** Whether the table held this group's row with that model id before the write. */
  holds: (modelId: string) => boolean;
}

/** The default this write moves, or undefined when it moves none. */
export function connectDefaultSwitch(facts: ConnectDefaultFacts): DefaultModelSwitch | undefined {
  const modelId = providerInfo(facts.provider)?.connectDefault;
  if (modelId === undefined || facts.hadKey || !facts.hasKey || !facts.holds(modelId)) {
    return undefined;
  }
  const { previous } = facts;
  if (previous?.provider === facts.provider && previous.modelId === modelId) return undefined;
  return {
    defaultModel: { provider: facts.provider, modelId },
    ...(previous !== undefined ? { previousDefault: previous } : {}),
  };
}
