/**
 * Builds the chat draft for editing one memory (the Memory tab's edit modal): names the memory
 * and its file, closes with the index-sync reminder and a "what to change" line — filled from
 * the modal's requirement field, or left trailing for the user to complete in the composer.
 * Pure — mirrors skill-import-source.ts, exported for unit tests.
 *
 * Read `S` inside the function, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import { S } from "../../lib/strings";

export function buildMemoryEditPrompt(title: string, filePath: string, requirement = ""): string {
  const base = `${S.memory.editPromptLead(title, filePath)}\n${S.memory.editPromptTail}`;
  const trimmed = requirement.trim();
  return trimmed.length > 0 ? `${base}${trimmed}` : base;
}
