/**
 * The prompt a "Create with AI" surface sends: the user's draft, then the surface's fixed
 * instruction tail after one blank line. The tail is what turns a novice's one-liner into
 * something the agent can act on (which object to create, where it lives, what to confirm),
 * so the panel previews it instead of appending it silently.
 */
export function composeAiPrompt(draft: string, tail?: string): string {
  const body = draft.trim();
  const fixed = tail?.trim() ?? "";
  if (fixed === "") return body;
  if (body === "") return fixed;
  return `${body}\n\n${fixed}`;
}
