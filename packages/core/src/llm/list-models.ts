/**
 * Endpoint model listing — the thin core wrapper over `AutoLLMClient.listModels()`.
 *
 * Exists so hosts (the server's models routes) can enumerate what an endpoint serves
 * without depending on MMSP directly: core mediates the MMSP boundary, MMSP owns the
 * client and the per-protocol `/models` call. A client named by its type speaks for
 * whatever the endpoint serves, so the listing is the endpoint's whole catalog; a client
 * with no models endpoint rejects with MMSP's `UnsupportedOperationError` (recognizable by
 * `err.name`).
 *
 * The key and the base URL go to MMSP as the caller gives them, and the environment is MMSP's
 * rule, as for a Session (PRN-021): a client handed no key reads its own `*_API_KEY` for its
 * default endpoint, calls an open MMSP server keyless, and refuses any other base URL before a
 * request, which reaches the caller as a ModelCredentialError (newAutoLLMClient). Other failures
 * surface as the SDK's own errors — callers collapse errors into their outcome shape, nothing is
 * caught here.
 */
import { userAgent } from "../index.js";
import { newAutoLLMClient } from "./model-client.js";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** MMSP client type to route through (the add-group flow passes a detected generic protocol). */
  clientType: string;
  /** Plaintext API key; omitted = whatever MMSP's client does with none for this base URL. */
  apiKey?: string;
  /** Endpoint base URL; omitted = the routed client's own `*_BASE_URL`, else its default. */
  baseUrl?: string;
}

/**
 * Lists the model ids the endpoint serves, in the order the endpoint returned them.
 * Throws whatever MMSP or the wrapped SDK throws (unsupported operation, auth,
 * network), or a ModelCredentialError when MMSP refuses a keyless base URL; bounding the call
 * in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const apiKey = options.apiKey || undefined;
  const baseUrl = options.baseUrl?.trim() || undefined;
  const client = newAutoLLMClient({
    // AutoLLMClient routes by clientType when given one; model is its fallback routing key
    // and must still be a string, so the client type doubles as it.
    model: options.clientType,
    clientType: options.clientType,
    ...(apiKey !== undefined ? { apiKey } : {}),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    // Spelled exactly so, as GenerativeModel spells it (see its constructor).
    defaultHeaders: { "User-Agent": userAgent() },
  });
  return client.listModels();
}
