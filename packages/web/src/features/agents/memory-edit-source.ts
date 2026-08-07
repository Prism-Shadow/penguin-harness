/**
 * Builds the prefilled chat draft for editing one memory (the Memory tab's "edit" action):
 * names the memory and its file, closes with the index-sync reminder and a trailing
 * "what to change" line the user completes before sending. Pure — mirrors
 * skill-import-source.ts, exported for unit tests.
 *
 * Read `S` inside the function, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import { S } from "../../lib/strings";

export function buildMemoryEditPrompt(title: string, filePath: string): string {
  return `${S.memory.editPromptLead(title, filePath)}\n${S.memory.editPromptTail}`;
}
