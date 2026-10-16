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
 * The key is the caller's to supply: core knows no vendor endpoint, so whether the
 * environment may lend a key to this URL is the host's decision (the server's catalog), made
 * before the call. With no key the listing is refused before a client exists — the wrapped
 * SDK would otherwise read the protocol's variable itself and send it to whatever endpoint
 * was typed — except on the mmsp client, which calls a base URL handed no key as an open MMSP
 * server (keylessEndpoint). Other failures surface as the SDK's own errors — callers collapse
 * errors into their outcome shape, nothing is caught here.
 */
import { AutoLLMClient } from "@prismshadow/mmsp";
import { userAgent } from "../index.js";
import { ModelCredentialError, keylessEndpoint } from "../state/model-connection.js";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** MMSP client type to route through (the add-group flow passes a detected generic protocol). */
  clientType: string;
  /** Plaintext API key; omitted = none, which only an open MMSP server accepts. */
  apiKey?: string;
  /** Endpoint base URL; omitted = the vendor default of the routed client. */
  baseUrl?: string;
}

/**
 * Lists the model ids the endpoint serves, in the order the endpoint returned them.
 * Throws whatever MMSP or the wrapped SDK throws (unsupported operation, auth,
 * network), or a ModelCredentialError when there is no key and the endpoint is not an open
 * MMSP server; bounding the call in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const apiKey = options.apiKey || undefined;
  // An open MMSP server is listed with no key, as the mmsp client calls it.
  if (apiKey === undefined && !keylessEndpoint(options.clientType, options.baseUrl)) {
    throw new ModelCredentialError(
      `No API key for ${options.baseUrl ?? "the endpoint"}: enter the endpoint's API key.`,
    );
  }
  const client = new AutoLLMClient({
    // AutoLLMClient routes by clientType when given one; model is its fallback routing key
    // and must still be a string, so the client type doubles as it.
    model: options.clientType,
    clientType: options.clientType,
    apiKey,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    // Spelled exactly so, as GenerativeModel spells it (see its constructor).
    defaultHeaders: { "User-Agent": userAgent() },
  });
  return client.listModels();
}
