/**
 * What the Agents page's "Create with AI" path hands the shared panel: the clickable examples
 * and the fixed instruction tail joined after the draft (the kit's composeAiPrompt). Both come
 * out of the active dictionary and are read at call time, never at module top level — the
 * dictionary binding is swapped on language switch. Pure, exported for unit tests.
 */
import { S } from "../../lib/strings";
import type { AiExample } from "../ai-create/ai-create-panel";

export function agentAiExamples(): AiExample[] {
  return S.agent.aiExamples.map((example) => ({ ...example }));
}

/** The tail that turns the description into an agent-initialization task in the current Project. */
export function agentAiTail(): string {
  return S.agent.aiCreateTail;
}
