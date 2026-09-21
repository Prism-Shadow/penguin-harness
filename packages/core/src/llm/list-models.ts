/**
 * Endpoint model listing — the thin core wrapper over `AutoLLMClient.listModels()`.
 *
 * Exists so hosts (the server's models routes) can enumerate what an endpoint serves
 * without depending on AgentHub directly: core mediates the AgentHub boundary, AgentHub
 * owns the client and the per-protocol `/models` call. Routed through a **generic protocol
 * client type** (`openai-responses` / `ant-messages` / `openai-chat`), the listing is the
 * endpoint's whole catalog; routed through a vendor-pinned type, AgentHub filters the ids
 * down to that client's own models, and a client with no models endpoint rejects with its
 * `UnsupportedOperationError` (recognizable by `err.name`).
 *
 * Credential semantics mirror the connectivity test: an omitted `apiKey` falls back to the
 * protocol's environment variable (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) **only when the
 * base URL is that vendor's own endpoint** (see endpointEnvApiKey) — the wrapped SDK would
 * otherwise read the variable itself and send the
 * user's vendor key to whatever endpoint was typed, so with no usable key the listing is
 * refused before a client exists. Other failures surface as the SDK's own errors — callers
 * collapse errors into their outcome shape, nothing is caught here.
 */
import { AutoLLMClient } from "@prismshadow/agenthub";
import {
  ModelCredentialError,
  endpointEnvApiKey,
  modelEnvFallback,
} from "../state/model-catalog.js";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** AgentHub client type to route through (the add-group flow passes a detected generic protocol). */
  clientType: string;
  /** Plaintext API key; omitted = the environment fallback for the protocol, where the endpoint allows one. */
  apiKey?: string;
  /** Endpoint base URL; omitted = the vendor default of the routed client. */
  baseUrl?: string;
  /** Environment the fallback reads; defaults to `process.env` (injectable for tests). */
  env?: Readonly<Record<string, string | undefined>>;
}

/**
 * Lists the model ids the endpoint serves, in the order the endpoint returned them.
 * Throws whatever AgentHub or the wrapped SDK throws (unsupported operation, auth,
 * network), or a ModelCredentialError when there is no key and the endpoint may not use
 * the environment's; bounding the call in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const apiKey =
    options.apiKey || endpointEnvApiKey(options.clientType, options.baseUrl, options.env);
  if (apiKey === undefined) {
    // Two different situations, two messages: the vendor's own endpoint with its variable
    // simply unset, and an endpoint the environment is not lent to at all.
    const allowed = modelEnvFallback({
      provider: "custom",
      modelId: "",
      clientType: options.clientType,
      baseUrl: options.baseUrl,
    });
    throw new ModelCredentialError(
      allowed !== undefined
        ? `No API key for ${options.baseUrl ?? "the endpoint"}: ${allowed.envKey} is not set in the server environment. Enter the API key, or set the variable.`
        : `No API key for ${options.baseUrl ?? "the endpoint"}. The environment lends a key only to a vendor's own endpoint: enter the endpoint's API key.`,
    );
  }
  const client = new AutoLLMClient({
    // AutoLLMClient routes by clientType when given one; model is its fallback routing key
    // and must still be a string, so the client type doubles as it.
    model: options.clientType,
    clientType: options.clientType,
    apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  return client.listModels();
}
