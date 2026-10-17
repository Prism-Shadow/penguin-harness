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
 * The credential rule is a Session's (PRN-021): with no key and no base URL, the client is built
 * with nothing and reads its own `*_API_KEY` / `*_BASE_URL` pair. With no key and a base URL,
 * the listing is refused before a client exists — the wrapped SDK would otherwise read the
 * protocol's variable itself and send it to whatever endpoint was typed — except on the mmsp
 * client, which calls a base URL handed no key as an open MMSP server (keylessEndpoint). Other
 * failures surface as the SDK's own errors — callers collapse errors into their outcome shape,
 * nothing is caught here.
 */
import { AutoLLMClient } from "@prismshadow/mmsp";
import { userAgent } from "../index.js";
import { ModelCredentialError, keylessEndpoint } from "../state/model-connection.js";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** MMSP client type to route through (the add-group flow passes a detected generic protocol). */
  clientType: string;
  /** Plaintext API key; omitted with a base URL = none, which only an open MMSP server accepts. */
  apiKey?: string;
  /** Endpoint base URL; omitted = the routed client's own `*_BASE_URL`, else its default. */
  baseUrl?: string;
}

/**
 * Lists the model ids the endpoint serves, in the order the endpoint returned them.
 * Throws whatever MMSP or the wrapped SDK throws (unsupported operation, auth,
 * network), or a ModelCredentialError when there is no key for a base URL that is not an open
 * MMSP server; bounding the call in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const apiKey = options.apiKey || undefined;
  const baseUrl = options.baseUrl?.trim() || undefined;
  // No base URL: the client reads its own pair, as a Session's would. An open MMSP server is
  // listed with no key, as the mmsp client calls it.
  if (
    apiKey === undefined &&
    baseUrl !== undefined &&
    !keylessEndpoint(options.clientType, baseUrl)
  ) {
    throw new ModelCredentialError(`No API key for ${baseUrl}: enter the endpoint's API key.`);
  }
  const client = new AutoLLMClient({
    // AutoLLMClient routes by clientType when given one; model is its fallback routing key
    // and must still be a string, so the client type doubles as it.
    model: options.clientType,
    clientType: options.clientType,
    apiKey,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    // Spelled exactly so, as GenerativeModel spells it (see its constructor).
    defaultHeaders: { "User-Agent": userAgent() },
  });
  return client.listModels();
}
