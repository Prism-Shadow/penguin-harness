/**
 * The editor state of a module document, kept apart from the view so it can be tested
 * without a DOM: how a document is shown as text, whether the text differs from it, and
 * what the text parses to before it is sent.
 */
import type { ModuleDocument, ModuleDocuments } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";

export type ModuleDocumentKind = "configuration" | "assessment";

/** A document as the editor shows it. */
export function documentText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** Whether the text says something other than the document, ignoring layout. */
export function documentChanged(text: string, value: unknown): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) !== JSON.stringify(value);
  } catch {
    return true;
  }
}

/** What the text parses to, or why it cannot be saved. */
export function parseDocument(
  text: string,
): { value: Record<string, unknown> } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    return { error: S.activities.moduleDocuments.notJson((cause as Error).message) };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return { error: S.activities.moduleDocuments.notObject };
  return { value: value as Record<string, unknown> };
}

/** The line that says where a document came from. */
export function documentOrigin(
  source: ModuleDocuments["source"],
  document: ModuleDocument,
): string {
  const words = S.activities.moduleDocuments;
  if (source === "draft") return words.fromDraft;
  return source === "run" ? words.fromRun(document.file) : words.fromCheckout(document.file);
}

/** How many items an assessment has, or null when it is not one. */
export function assessmentItemCount(value: unknown): number | null {
  return value && typeof value === "object" && Array.isArray((value as { items?: unknown }).items)
    ? (value as { items: unknown[] }).items.length
    : null;
}
