/**
 * What the Vault tab's "add with AI" dialog hands the shared panel: the examples and the fixed
 * tail. The prompt goes to the Project's default agent (the one carrying the penguin-config
 * skill), so the tail names the agent whose vault this is and its Project explicitly — the CLI
 * would otherwise default both to the built-in ids. Read from the active dictionary at call
 * time, never at module top level. Pure, exported for unit tests.
 */
import { S } from "../../lib/strings";
import type { AiExample } from "../ai-create/ai-create-panel";

export function vaultAiExamples(): AiExample[] {
  return S.vault.aiAddExamples.map((example) => ({ ...example }));
}

export function vaultAiTail(agentId: string, projectId: string): string {
  return S.vault.aiAddTail(agentId, projectId);
}
