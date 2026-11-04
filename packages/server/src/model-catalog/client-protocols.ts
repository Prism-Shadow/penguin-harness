/**
 * What the UI needs to know about MMSP's clients: which client an entry reaches (MMSP's own
 * routedClientType, passed through), the path that client appends to its base URL, and the
 * protocol that carries fast mode on it. MMSP's credentials module answers the routing; the
 * catalog keeps no copy of it and adds only what MMSP exports nothing for (CLIENT_PROTOCOLS).
 *
 * A leaf: it imports MMSP's browser-safe credentials module and nothing of the catalog, so the
 * catalog, the environment-key previews and the browser may all read it.
 */
import { routedClientType } from "@prismshadow/mmsp/credentials";

// MMSP's routing, passed through for browser code that reads the catalog: which client an entry
// reaches (its pinned client type, else its id's family), or null where nothing routes.
export { routedClientType } from "@prismshadow/mmsp/credentials";

/**
 * The wire protocol that carries MMSP's `fast_mode` on a client: `"openai"` for the clients
 * that send `service_tier: "priority"` (the OpenAI protocols, and Google's Interactions API
 * and MiniMax alike), `"anthropic"` for those that send `speed: "fast"` plus the
 * `fast-mode-2026-02-01` beta header. The two differ in what the user must be warned about,
 * not just in wire shape.
 */
export type FastModeProtocol = "openai" | "anthropic";

/**
 * What the UI shows about each MMSP client, which MMSP exports nothing for: the path it appends
 * to its base URL (the models page's endpoint hint) and the protocol that carries `fast_mode`
 * (absent = the client rejects it, or the harness cannot tell what it does with it). Keyed by
 * the canonical client type MMSP's routedClientType returns; the catalog test holds it to the
 * client types MMSP's credentials module knows.
 */
export const CLIENT_PROTOCOLS: Readonly<
  Record<string, { path: string; fastMode?: FastModeProtocol }>
> = {
  "openai-official": { path: "/responses", fastMode: "openai" },
  "anthropic-official": { path: "/v1/messages", fastMode: "anthropic" },
  "google-official": { path: "/v1beta/interactions", fastMode: "openai" },
  "zai-official": { path: "/chat/completions" },
  "moonshot-official": { path: "/chat/completions" },
  "deepseek-official": { path: "/responses" },
  "minimax-official": { path: "/responses", fastMode: "openai" },
  "openai-responses": { path: "/responses", fastMode: "openai" },
  "openai-chat": { path: "/chat/completions", fastMode: "openai" },
  "openai-chat-vllm-adapter": { path: "/chat/completions", fastMode: "openai" },
  "openai-embedding": { path: "/embeddings" },
  "ant-messages": { path: "/v1/messages", fastMode: "anthropic" },
  "google-genai": { path: "/v1beta/models" },
  // An MMSP server: the client posts to {base}/stream. It forwards `fast_mode` to the server,
  // whose upstream client decides, so the harness offers no toggle it cannot vouch for.
  mmsp: { path: "/stream" },
};

/**
 * Whether a model can carry fast mode at all, and on which protocol - `undefined` means no.
 *
 * The fast tier is a property of the **client MMSP routes to** (MMSP's routedClientType), never of
 * the catalog row: the registry carries no fast-tier capability flag, but the routing is
 * deterministic, so the answer is too. This reports what the selected client does with the
 * parameter:
 *
 * - maps it -> the protocol, and the toggle may be offered;
 * - raises UnsupportedParameterError (the Z.AI, Moonshot, DeepSeek, google-genai and
 *   embedding clients, and anthropic-official on Bedrock or for the generations that reject
 *   the `speed` parameter) -> `undefined`;
 * - forwards it to an MMSP server, whose upstream client decides what it does with it (mmsp)
 *   -> `undefined`: the harness cannot say on which protocol, or whether at all;
 * - routes nowhere (AutoLLMClient throws for an id it cannot place) -> `undefined` as well,
 *   since a model that cannot run has no fast tier either.
 *
 * A rule rather than a per-model list on purpose: catalog rows added later inherit the right
 * answer without anyone remembering to update a table.
 *
 * `"anthropic"` is reported for every Claude the client serves, including ids outside the
 * research preview's Opus allowlist: Anthropic answers those with a 429 at request time, which
 * is something to warn about before enabling, not grounds to hide the setting.
 *
 * Two runtime inputs stay invisible to a pure function of the config and can still flip the
 * answer: the server's `CLIENT_TYPE` env var names the client for an entry that pins none, and
 * `ANTHROPIC_BASE_URL` supplies the base URL when the entry leaves it blank (so a `bedrock://`
 * there sends Claude to Bedrock, which has no fast tier). Third-party OpenAI-compatible
 * endpoints are a third: they accept `service_tier` and may quietly serve the standard tier.
 * That residue is why llm/generative-model.ts still handles the rejection at runtime.
 */
export function fastModeProtocol(
  modelId: string,
  clientType?: string,
  baseUrl?: string,
): FastModeProtocol | undefined {
  // A blank pin is none, which routes by the id.
  const routed = routedClientType(modelId, clientType?.trim() ? clientType : null);
  // Bedrock has no fast tier, and these Claude generations reject the `speed` parameter (MMSP
  // 0.5.2's NO_FAST_MODE); both tests run against what the client was constructed with, as the
  // client's own do.
  if (
    routed === "anthropic-official" &&
    (baseUrl?.startsWith("bedrock://") ||
      ["4-6", "sonnet-5-5", "haiku-5-5", "fable-5-1"].some((generation) =>
        modelId.includes(generation),
      ))
  ) {
    return undefined;
  }
  return routed === null ? undefined : CLIENT_PROTOCOLS[routed]?.fastMode;
}
