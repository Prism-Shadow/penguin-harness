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
 * Credential semantics mirror the connectivity test: an omitted `apiKey` falls back to the
 * protocol's environment variable (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) **only when the
 * base URL is that vendor's own endpoint** (see endpointEnvApiKey) — the wrapped SDK would
 * otherwise read the variable itself and send the
 * user's vendor key to whatever endpoint was typed, so with no usable key the listing is
 * refused before a client exists — except on the mmsp client, which calls a base URL handed
 * no key as an open MMSP server (keylessEndpoint). Other failures surface as the SDK's own
 * errors — callers collapse errors into their outcome shape, nothing is caught here.
 */
import { AutoLLMClient } from "@prismshadow/mmsp";
import {
  ModelCredentialError,
  endpointEnvApiKey,
  keylessEndpoint,
  modelEnvFallback,
} from "../state/model-catalog.js";

/** One endpoint listing request: which protocol to speak, and the credential/URL to speak it with. */
export interface ListEndpointModelsOptions {
  /** MMSP client type to route through (the add-group flow passes a detected generic protocol). */
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
 * Throws whatever MMSP or the wrapped SDK throws (unsupported operation, auth,
 * network), or a ModelCredentialError when there is no key and the endpoint may not use
 * the environment's; bounding the call in time is the caller's concern.
 */
export async function listEndpointModels(options: ListEndpointModelsOptions): Promise<string[]> {
  const apiKey =
    options.apiKey || endpointEnvApiKey(options.clientType, options.baseUrl, options.env);
  // An open MMSP server is listed with no key, as the mmsp client calls it.
  if (apiKey === undefined && !keylessEndpoint("", options.clientType, options.baseUrl)) {
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
