/**
 * The prompt behind the Import workbench dialog's chat import (pure logic, unit tested): a lead
 * sentence chosen by the kind of the pasted source (classifyImportSource, the Import skill
 * dialog's buckets), and the fixed instruction tail joined after it. The tail carries what the
 * agent cannot guess — reading every file and stopping on anything suspect before installing,
 * since a workbench's page runs inside the app and its handlers run on this server; the package
 * layout of the penguin-plugin Skill; and where to install and reload it — and names the
 * destination by Project and Agent id. Reads S at call time (live binding), so both follow
 * language switches like every other string consumer.
 */
import { S } from "../../lib/strings";
import { composeAiPrompt } from "../ai-create";
import { classifyImportSource } from "./skill-import-source";

/** Lead sentence for one source: one per source kind, each embedding the trimmed source. */
export function workbenchImportLead(input: string): string {
  const source = input.trim();
  return S.workbenches.importPromptLead[classifyImportSource(source)](source);
}

/** The fixed tail for installing into `agentId` of `projectId` (shown in the dialog's prompt preview). */
export function workbenchImportTail(projectId: string, agentId: string): string {
  return S.workbenches.importPromptTail(projectId, agentId);
}

/** The whole prompt that is sent: the lead, then the tail after one blank line. */
export function buildWorkbenchImportPrompt(
  input: string,
  projectId: string,
  agentId: string,
): string {
  return composeAiPrompt(workbenchImportLead(input), workbenchImportTail(projectId, agentId));
}
