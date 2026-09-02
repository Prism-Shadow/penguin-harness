/**
 * The "let AI import" mode of the Hooks tab's import dialog (pure logic, unit tested): the
 * clickable examples, and the fixed instruction tail joined after the user's draft. The tail
 * carries what the agent cannot guess — the review step, the hook package format, the script
 * contract and where to install — and names the destination by Project and Agent id, because
 * the prompt goes to the Project's default agent rather than to the Agent the package is for.
 * Reads S at call time (live binding), so both follow language switches like every other
 * string consumer.
 */
import { S } from "../../lib/strings";
import { composeAiPrompt } from "../ai-create";
import type { AiExample } from "../ai-create";

/** The examples offered under the prompt box; a click replaces the draft with the example's prompt. */
export function hookImportExamples(): AiExample[] {
  return [...S.hooks.importExamples];
}

/** The fixed tail for installing into `agentId` of `projectId` (previewed in the panel's "Full prompt" fold). */
export function hookImportTail(projectId: string, agentId: string): string {
  return S.hooks.importPromptTail(projectId, agentId);
}

/** The whole prompt that is sent: the draft, then the tail after one blank line. */
export function buildHookImportPrompt(draft: string, projectId: string, agentId: string): string {
  return composeAiPrompt(draft, hookImportTail(projectId, agentId));
}
