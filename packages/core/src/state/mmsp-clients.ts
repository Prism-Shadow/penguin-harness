/**
 * MMSP's client types as the harness mirrors them: the variable prefix each client reads when
 * handed no credential, the path it appends to its base URL, the protocol that carries fast mode,
 * and the client that calls an open server keyless — plus the canonical spelling and equality
 * routing sees. Protocol knowledge, not model knowledge: core may hold it (see the core rule in
 * the dev skill), and it changes only with the MMSP release that changes a client.
 *
 * No imports at all, so the browser bundles it through the `model-connection` subpath, which
 * re-exports it.
 */

/**
 * The wire protocol that carries MMSP's `fast_mode` on a client: `"openai"` for the clients
 * that send `service_tier: "priority"` (the OpenAI protocols, and Google's Interactions API
 * and MiniMax alike), `"anthropic"` for those that send `speed: "fast"` plus the
 * `fast-mode-2026-02-01` beta header. The two differ in what the user must be warned about,
 * not just in wire shape.
 */
export type FastModeProtocol = "openai" | "anthropic";

/**
 * What the harness mirrors about each MMSP client, in one place: the environment variable
 * prefix it reads its key and base URL from when handed none (an official client its vendor's,
 * a compatible client the vendor's whose wire protocol it speaks), the path it appends to its
 * base URL, the protocol that carries `fast_mode` (absent = the client rejects it, or the
 * harness cannot tell what it does with it), and `openServer` for a client that calls a base
 * URL handed no key with no key at all where every other client refuses it (see
 * keylessEndpoint). A client type this table does not name is one MMSP does not have either.
 */
export const MMSP_CLIENTS: Readonly<
  Record<string, { env: string; path: string; fastMode?: FastModeProtocol; openServer?: true }>
> = {
  "openai-official": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "anthropic-official": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  // compat: MMSP 0.5.2 keeps google-official's earlier name as an alias, and a Project written
  // before it may still pin it, never rewritten; this row goes with the MMSP upgrade that drops
  // the alias (changelog/0.2.15/2026-10-10-backward-compatibility.md).
  "gemini-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  "zai-official": { env: "ZAI", path: "/chat/completions" },
  "moonshot-official": { env: "MOONSHOT", path: "/chat/completions" },
  "deepseek-official": { env: "DEEPSEEK", path: "/responses" },
  "minimax-official": { env: "MINIMAX", path: "/responses", fastMode: "openai" },
  "openai-responses": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "openai-chat": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-chat-vllm-adapter": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-embedding": { env: "OPENAI", path: "/embeddings" },
  "ant-messages": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-genai": { env: "GEMINI", path: "/v1beta/models" },
  // MMSP 0.5.1 keeps the 0.5.0 name of google-genai as an alias.
  "gemini-generate-content": { env: "GEMINI", path: "/v1beta/models" },
  // An MMSP server: the client posts to {base}/stream. It forwards `fast_mode` to the server,
  // whose upstream client decides, so the harness offers no toggle it cannot vouch for.
  mmsp: { env: "MMSP", path: "/stream", openServer: true },
};

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

/** The MMSP_CLIENTS row a client type names (canonical spelling, case and space ignored), or undefined. */
export function mmspClient(
  clientType: string | undefined,
): (typeof MMSP_CLIENTS)[string] | undefined {
  const name = canonicalClientType(clientType?.trim() || undefined)?.toLowerCase();
  return name !== undefined && Object.hasOwn(MMSP_CLIENTS, name) ? MMSP_CLIENTS[name] : undefined;
}

/** Client-type equality as routing sees it: canonical spelling (canonicalClientType), case and surrounding space ignored. */
export function sameClientType(a: string, b: string): boolean {
  const norm = (value: string): string => canonicalClientType(value.trim())!.toLowerCase();
  return norm(a) === norm(b);
}
