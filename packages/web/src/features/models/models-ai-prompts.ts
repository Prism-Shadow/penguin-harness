/**
 * What the Models page's "add with AI" dialog hands the shared panel: the examples and the fixed
 * tail, which carries the current Project id because `penguin config model add` defaults its
 * `--project-id` to the built-in Project. Read from the active dictionary at call time, never at
 * module top level. Pure, exported for unit tests.
 */
import { S } from "../../lib/strings";
import type { AiExample } from "../ai-create/ai-create-panel";

export function modelsAiExamples(): AiExample[] {
  return S.models.aiAddExamples.map((example) => ({ ...example }));
}

export function modelsAiTail(projectId: string): string {
  return S.models.aiAddTail(projectId);
}
