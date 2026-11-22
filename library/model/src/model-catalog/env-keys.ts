/**
 * The environment variables a model reads, and where its requests go while no base URL is set, as
 * the UI presents them (PRN-021). The rule is MMSP's
 * alone: its credentials module (`environmentCredential`) says what a client handed no key does
 * with the base URL it is handed, and the harness keeps no copy of it. This names the variables
 * for the server's `GET /models` preview, the machine sync's report, the web dialogs' hints, the
 * CLI's list, protocol detection and the balance query, so none of them can disagree with what a
 * Session's client does.
 */
import {
  CLIENT_CREDENTIALS,
  environmentCredential,
  routedClientType,
} from "@prismshadow/mmsp/credentials";
import { effectiveConnection } from "@prismshadow/penguin-core/model-connection";
import type {
  ModelCredentialShape,
  ProviderConnectionShape,
} from "@prismshadow/penguin-core/model-connection";
import { providerInfo, vendorClientType } from "./catalog.js";

/**
 * The variable MMSP's client of this type reads its key from when handed none at this base URL
 * (environmentCredential), or undefined: the client refuses that URL, calls it keyless, or is
 * not one MMSP has. With no base URL it is always the client's own `*_API_KEY`.
 */
export function clientEnvKey(clientType: string, baseUrl: string | undefined): string | undefined {
  const credential = environmentCredential(clientType, baseUrl?.trim() || undefined);
  return credential?.kind === "env" ? credential.apiKeyEnv : undefined;
}

/**
 * Whether MMSP's client of this type, handed no key at this base URL and with the variable it
 * would read unset, calls the endpoint without a key. `environmentCredential` says so outright
 * for an open server's client (`mmsp`, `openai-chat-vllm-adapter`) handed any base URL; handed
 * none, such a client reads its `*_API_KEY` and, finding it unset, calls keyless too. vLLM's
 * client then sends vLLM's placeholder key `EMPTY`.
 */
function calledKeyless(clientType: string, baseUrl: string | undefined): boolean {
  const credential = environmentCredential(clientType, baseUrl?.trim() || undefined);
  if (credential?.kind === "keyless") return true;
  if (credential?.kind !== "env") return false;
  const routed = routedClientType("", clientType);
  return routed !== null && CLIENT_CREDENTIALS[routed]?.openServer === true;
}

/**
 * A group whose key comes from a sign-in flow (the catalog's `bridgeAuth`: Penguin Go's relay)
 * serves an endpoint that takes no call without that key, whatever its client would do.
 */
function signInKeyed(providerId: string): boolean {
  return providerInfo(providerId)?.bridgeAuth !== undefined;
}

/** The variables MMSP's routed client reads for a row as configured (see modelEnvironment). */
export interface ModelEnvironment {
  /** The key's variable: only for a row with no key in the file. */
  apiKeyEnv?: string;
  /** The endpoint's variable: only for a row with no base URL in the file. */
  baseUrlEnv?: string;
  /**
   * Where that row's requests go while `baseUrlEnv` is unset: the routed client's default
   * endpoint, as MMSP's credentials table records it. Present exactly when `baseUrlEnv` is.
   */
  defaultBaseUrl?: string;
}

/**
 * What a row takes from the environment, as MMSP decides it (PRN-021). The row's effective
 * connection (core's effectiveConnection) picks the client MMSP routes it to (`routedClientType`)
 * and the base URL that client is handed; `environmentCredential` then says what the client
 * reads. With no key in the file it reads its `*_API_KEY` only for no base URL or its own default
 * endpoint, and with no base URL in the file it goes where its `*_BASE_URL` points, key or not.
 * A row MMSP refuses (no key and another base URL), an open MMSP server and a row nothing routes
 * read nothing. With no base URL in the file the row also names the endpoint its requests go to
 * while that variable is unset (`defaultBaseUrl`). `entry` is the row's OWN values, key
 * included, and `group` its `[providers.<id>]` table.
 */
export function modelEnvironment(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): ModelEnvironment {
  const effective = effectiveConnection(entry, group);
  const routed = routedClientType(entry.modelId, effective.clientType ?? null);
  if (routed === null) return {};
  const credential = environmentCredential(routed, effective.baseUrl);
  if (credential?.kind !== "env") return {};
  const defaultBaseUrl = CLIENT_CREDENTIALS[routed]?.defaultBaseUrl;
  return {
    ...(effective.apiKey === undefined ? { apiKeyEnv: credential.apiKeyEnv } : {}),
    ...(credential.baseUrlEnv !== null
      ? {
          baseUrlEnv: credential.baseUrlEnv,
          ...(defaultBaseUrl !== undefined ? { defaultBaseUrl } : {}),
        }
      : {}),
  };
}

/**
 * The variable a row with no key in the file authenticates with, or undefined: modelEnvironment's
 * `apiKeyEnv`. The server's `GET /models` preview, the web dialog's hint and the CLI's list read
 * this, so none of them can disagree with what a Session does.
 */
export function modelEnvPreviewKey(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): string | undefined {
  return modelEnvironment(entry, group).apiKeyEnv;
}

/**
 * MMSP's client for a group as a whole: the group protocol's when it names one, else, for a
 * first-party vendor group, the vendor's (vendorClientType). Undefined for a gateway, custom,
 * vLLM or user-defined group with no protocol, whose rows route by id.
 */
function groupClientType(
  providerId: string,
  group: Pick<ProviderConnectionShape, "clientType"> | undefined,
): string | undefined {
  const pinned = group?.clientType?.trim() ? group.clientType : undefined;
  return pinned ?? vendorClientType(providerId);
}

/**
 * The variable a group's settings may present as covering a blank group key, or undefined —
 * the group dialog's hint: what MMSP's client for the group (groupClientType) reads when handed
 * no key at the group's base URL (clientEnvKey). A group with no one client names nothing.
 */
export function providerEnvFallbackKey(
  providerId: string,
  group: Pick<ProviderConnectionShape, "baseUrl" | "clientType"> | undefined,
): string | undefined {
  const clientType = groupClientType(providerId, group);
  return clientType === undefined ? undefined : clientEnvKey(clientType, group?.baseUrl);
}

/**
 * Whether a group with no key, and its client's variable unset, has its rows called without a
 * key — the group dialog's "send no key" hint: MMSP's client for the group (groupClientType) at
 * the group's base URL calls it keyless (calledKeyless). A group with no one client, and one
 * keyed by a sign-in flow, answers no.
 */
export function providerCalledKeyless(
  providerId: string,
  group: Pick<ProviderConnectionShape, "baseUrl" | "clientType"> | undefined,
): boolean {
  if (signInKeyed(providerId)) return false;
  const clientType = groupClientType(providerId, group);
  return clientType !== undefined && calledKeyless(clientType, group?.baseUrl);
}

/**
 * Whether a row with no key of its own or its group's, and its client's variable unset, is
 * called without a key — the model dialog's "send no key" hint: its routed client at its
 * effective base URL calls it keyless (calledKeyless). A row of a sign-in-keyed group, and one
 * nothing routes, answers no. `entry` is the row's OWN values, and `group` its table.
 */
export function modelCalledKeyless(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): boolean {
  if (signInKeyed(entry.provider)) return false;
  const effective = effectiveConnection(entry, group);
  if (effective.apiKey !== undefined) return false;
  const routed = routedClientType(entry.modelId, effective.clientType ?? null);
  return routed !== null && calledKeyless(routed, effective.baseUrl);
}
