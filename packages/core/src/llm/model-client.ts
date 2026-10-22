/**
 * Where core builds an MMSP client, and how MMSP's refusal of a missing key reads.
 *
 * Core hands AutoLLMClient the key, base URL and client type the Project config resolves to and
 * nothing else (state/model-connection.ts). Who may use an environment key is MMSP's rule
 * (PRN-021): a client handed no key and a base URL other than its own default endpoint refuses
 * with ApiKeyRequiredError when it is built, before any request. Every client core builds goes
 * through newAutoLLMClient, which turns that refusal into a ModelCredentialError worded for the
 * person who configures the model: the Project config's two fixes rather than MMSP's parameter
 * names.
 */
import { ApiKeyRequiredError, AutoLLMClient } from "@prismshadow/mmsp";

/** What AutoLLMClient is built with. */
export type AutoLLMClientOptions = ConstructorParameters<typeof AutoLLMClient>[0];

/**
 * A model that cannot be given to its MMSP client as configured: no key in the Project config,
 * and a base URL MMSP will not send the environment's key to. The message names the base URL and
 * what to do, and says "API key", so hosts that classify credential errors by message (the
 * server's `isMissingCredential`) file it with the SDKs' own missing-credential errors.
 */
export class ModelCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCredentialError";
  }
}

/** MMSP's refusal in the Project config's terms; `model` names the model, absent for a listing. */
function refusalMessage(err: ApiKeyRequiredError, model: string | undefined): string {
  if (model === undefined) return `No API key for ${err.baseUrl}: enter the endpoint's API key.`;
  return (
    `Model ${model} has no API key for ${err.baseUrl}: ${err.apiKeyEnv} is used only for the ` +
    `client's default endpoint or the one ${err.baseUrlEnv} names. Set the API key on the model ` +
    `or its group, or clear the base URL and set ${err.apiKeyEnv} (with ${err.baseUrlEnv} for ` +
    `another endpoint) in the server environment.`
  );
}

/**
 * Builds the AutoLLMClient for `options`. MMSP's ApiKeyRequiredError is rethrown as a
 * ModelCredentialError for `model` (absent: an endpoint listing, whose user types the key);
 * anything else the constructor throws, a provider SDK's own missing credential included,
 * passes through unchanged.
 */
export function newAutoLLMClient(options: AutoLLMClientOptions, model?: string): AutoLLMClient {
  try {
    return new AutoLLMClient(options);
  } catch (err) {
    if (err instanceof ApiKeyRequiredError) {
      throw new ModelCredentialError(refusalMessage(err, model));
    }
    throw err;
  }
}
