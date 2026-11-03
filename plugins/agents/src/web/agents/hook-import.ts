/**
 * The prompt behind the Hooks tab's chat import (pure logic, unit tested): the lead sentence
 * derived from the pasted source, and the fixed instruction tail joined after it. The tail
 * carries what the agent cannot guess — the review step, the hook package format, the script
 * contract and where to install — and names the destination by Project and Agent id. Reads S
 * at call time (live binding), so both follow language switches like every other string
 * consumer.
 */
import { S } from "../../lib/strings";
import { composeAiPrompt } from "../ai-create";
import { classifyImportSource } from "./skill-import-source";

/**
 * Lead sentence for one source. A URL, repository or local path is something to fetch, so it
 * is wrapped in an import instruction; anything else is already free text the user wrote (a
 * description of the hook, or a hooks config block pasted from another tool) and is passed
 * through verbatim.
 */
export function hookImportLead(input: string): string {
  const source = input.trim();
  const kind = classifyImportSource(source);
  if (kind === "webUrl" || kind === "repoUrl" || kind === "localPath") {
    return S.hooks.importPromptLead(source);
  }
  return source;
}

/** The fixed tail for installing into `agentId` of `projectId` (shown in the dialog's prompt preview). */
export function hookImportTail(projectId: string, agentId: string): string {
  return S.hooks.importPromptTail(projectId, agentId);
}

/** The whole prompt that is sent: the lead, then the tail after one blank line. */
export function buildHookImportPrompt(input: string, projectId: string, agentId: string): string {
  return composeAiPrompt(hookImportLead(input), hookImportTail(projectId, agentId));
}
