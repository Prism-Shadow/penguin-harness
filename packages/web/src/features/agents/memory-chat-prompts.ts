/**
 * Builds the chat drafts of the Memory tab's two bridge modals (edit one memory / add into one
 * scope). The drafts stay minimal on purpose: the save mechanics — frontmatter, index upkeep —
 * already live in the agent's Memory prompt, so each draft only names its target (the memory's
 * title / the scope by kind, not by path). Pure — mirrors skill-import-source.ts, exported for
 * unit tests.
 *
 * Read `S` inside the functions, never at module top level: the dictionary binding is swapped
 * on language switch.
 */
import { S } from "../../lib/strings";

export function buildMemoryEditPrompt(title: string, requirement = ""): string {
  const base = `${S.memory.editPromptLead(title)}\n${S.memory.editPromptTail}`;
  const trimmed = requirement.trim();
  return trimmed.length > 0 ? `${base}${trimmed}` : base;
}

/**
 * The add modal's draft: content (pasted text, a file path, or a URL — the agent reads sources
 * itself, so no source classification is needed) into the scope the button was clicked on.
 * Content is required; the modal keeps its actions disabled while it is empty.
 */
export function buildMemoryAddPrompt(kind: "user" | "workspace", content: string): string {
  return `${S.memory.addPromptLead[kind]}\n${content.trim()}`;
}
