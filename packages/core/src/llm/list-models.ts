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
 * Credential semantics mirror the connectivity test: an omitted `apiKey` lets the wrapped
 * SDK read the protocol's own environment variable (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`),
 * and a missing credential surfaces as the SDK's own construction/request error — callers
 * collapse errors into their outcome shape, nothing is caught here.
 */
import { AutoLLMClient } from "@prismshadow/agenthub";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** AgentHub client type to route through (the add-group flow passes a detected generic protocol). */
  clientType: string;
  /** Plaintext API key; omitted = the SDK's environment fallback for the protocol. */
  apiKey?: string;
  /** Endpoint base URL; omitted = the vendor default of the routed client. */
  baseUrl?: string;
}

/**
 * Lists the model ids the endpoint serves, in the order the endpoint returned them.
 * Throws whatever AgentHub or the wrapped SDK throws (unsupported operation, auth,
 * network); bounding the call in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const client = new AutoLLMClient({
    // AutoLLMClient routes by clientType when given one; model is its fallback routing key
    // and must still be a string, so the client type doubles as it.
    model: options.clientType,
    clientType: options.clientType,
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  });
  return client.listModels();
}
