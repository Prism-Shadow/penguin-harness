/**
 * MMSP's routing, mirrored: which client an entry reaches (its pinned client type, else the
 * official client of the family its id begins with), the variable pair that client reads when
 * handed no credential, and the protocol that carries fast mode on it. MMSP does not export
 * its family table, so this copy moves only with the MMSP release that changes it.
 *
 * A leaf: it imports core's browser-safe client table and nothing of the catalog, so the
 * catalog, the environment-key previews and the seed may all read it.
 */
import { MMSP_CLIENTS, canonicalClientType } from "@prismshadow/penguin-core/model-connection";
import type { FastModeProtocol } from "@prismshadow/penguin-core/model-connection";

/** Env var fallback for a single model (the var names MMSP's client actually reads when api_key / base_url is blank). */
export interface ModelEnvInfo {
  envKey: string;
  envBaseUrlKey: string;
}

/**
 * MMSP's routing rule, mirrored: without a client type, the family a model id begins with
 * names its official client (AutoLLMClient's `MODEL_FAMILIES` as of MMSP 0.5.2, which the
 * package does not export), and an id of no known family cannot be started at all.
 */
const MODEL_FAMILIES: readonly (readonly [prefix: string, clientType: string])[] = [
  ["gpt-", "openai-official"],
  ["text-embedding-", "openai-official"],
  ["claude-", "anthropic-official"],
  ["gemini-", "google-official"],
  ["glm-", "zai-official"],
  ["kimi-", "moonshot-official"],
  ["deepseek-", "deepseek-official"],
  ["minimax-", "minimax-official"],
];

/**
 * The MMSP client that serves an entry, exactly as AutoLLMClient picks it: the pinned client
 * type (lowercased; the bare `openai` alias canonicalized), else the official client of the
 * family the model id begins with — where `openai-official` hands a `text-embedding-` id to
 * the Embeddings client. `undefined` when MMSP refuses the entry: an id of no known family,
 * or a pin MMSP does not have.
 */
export function routedClientType(modelId: string, clientType?: string): string | undefined {
  const id = modelId.toLowerCase();
  const routed =
    canonicalClientType(clientType)?.trim().toLowerCase() ||
    MODEL_FAMILIES.find(([prefix]) => id.startsWith(prefix))?.[1];
  if (routed === "openai-official" && id.startsWith("text-embedding-")) return "openai-embedding";
  return routed !== undefined && Object.hasOwn(MMSP_CLIENTS, routed) ? routed : undefined;
}

/**
 * Resolves the env var fallback for a model: the pair the client MMSP routes it to reads
 * (see routedClientType). Returns undefined when nothing routes — an id of no known family
 * with no client type, or a client type MMSP does not have — which is exactly when MMSP
 * rejects the entry: it needs an explicit client_type, or should be added under custom / a
 * self-built group via the OpenAI protocol.
 */
export function resolveModelEnv(modelId: string, clientType?: string): ModelEnvInfo | undefined {
  const client = MMSP_CLIENTS[routedClientType(modelId, clientType) ?? ""];
  if (client === undefined) return undefined;
  return { envKey: `${client.env}_API_KEY`, envBaseUrlKey: `${client.env}_BASE_URL` };
}

/**
 * Whether a model can carry fast mode at all, and on which protocol - `undefined` means no.
 *
 * The fast tier is a property of the **client MMSP routes to** (routedClientType), never of
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
  const routed = routedClientType(modelId, clientType);
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
  return MMSP_CLIENTS[routed ?? ""]?.fastMode;
}
