/**
 * How the harness spells and compares a stored MMSP client type: the one legacy spelling it
 * converges on (`openai` -> `openai-chat`) and equality as config writes see it. Which client a
 * type reaches, and what that client reads, is MMSP's to say (`@prismshadow/mmsp/credentials`);
 * nothing here mirrors MMSP's client table. Changes only with an MMSP rename the harness rewrites.
 *
 * No imports at all, so the browser bundles it through the `model-connection` subpath, which
 * re-exports it.
 */

/**
 * Canonical spelling of an MMSP client-type string. The generic Chat Completions client was
 * renamed from `openai` to `openai-chat` (AgentHub 0.4.2); the bare `openai` spelling still
 * routes upstream as a deprecated alias, but the harness converges on the canonical name —
 * config reads/writes and API request handling all normalize through here, so configs saved
 * before the rename keep working while comparisons (legacy-protocol display, catalog sync)
 * see one spelling. Any other value (including `openai-responses` / `openai-embedding`,
 * which merely contain "openai") passes through unchanged.
 */
export function canonicalClientType(clientType: string | undefined): string | undefined {
  if (clientType === undefined) return undefined;
  return clientType.trim().toLowerCase() === "openai" ? "openai-chat" : clientType;
}

/** Client-type equality as routing sees it: canonical spelling (canonicalClientType), case and surrounding space ignored. */
export function sameClientType(a: string, b: string): boolean {
  const norm = (value: string): string => canonicalClientType(value.trim())!.toLowerCase();
  return norm(a) === norm(b);
}
