/**
 * Builds the chat drafts of the Memory tab's two bridge modals (edit one memory / import into
 * one scope): each names its target and closes with the index-sync reminder, so the agent keeps
 * file and MEMORY.md in step. Pure — mirrors skill-import-source.ts, exported for unit tests.
 *
 * Read `S` inside the functions, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import { S } from "../../lib/strings";

export function buildMemoryEditPrompt(title: string, filePath: string, requirement = ""): string {
  const base = `${S.memory.editPromptLead(title, filePath)}\n${S.memory.editPromptTail}`;
  const trimmed = requirement.trim();
  return trimmed.length > 0 ? `${base}${trimmed}` : base;
}

/**
 * The import modal's draft: content (pasted text, a file path, or a URL — the agent reads
 * sources itself, so no source classification is needed) into the scope directory the button
 * was clicked on. Content is required; the modal keeps its actions disabled while it is empty.
 */
export function buildMemoryImportPrompt(targetDir: string, content: string): string {
  return `${S.memory.importPromptLead(targetDir)}\n${S.memory.importPromptTail}${content.trim()}`;
}
