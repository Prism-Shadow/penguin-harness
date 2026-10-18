/**
 * How a Project config row is connected: its effective connection (row -> group -> none, per
 * field), and the values an MMSP client is built with for it.
 *
 * Everything here is config inheritance and nothing else. Core knows no model, provider group,
 * vendor host or endpoint: the built-in catalog lives in the server package and reaches core
 * only through the file it seeds (`[providers.<id>]`, `[[models]]`) or through host hooks.
 *
 * The environment is MMSP's (PRN-021): core hands the routed client the key, base URL and client
 * type the file resolves to, verbatim, and nothing that is absent. A client handed no key reads
 * its `*_API_KEY` only for its own default endpoint (no base URL, or exactly that one), and
 * refuses any other base URL with ApiKeyRequiredError before any request, except the `mmsp`
 * client, which calls an open server keyless. Core never reads an environment variable and
 * never decides who may use one.
 *
 * Its one runtime import is client-type.ts, which imports nothing, so the Web App bundles it
 * through the `@prismshadow/penguin-core/model-connection` subpath.
 */
import { canonicalClientType } from "./client-type.js";
import type { ModelEntry, ProviderConnection } from "./project-config.js";

// How a stored client type is spelled and compared travels with this browser-safe subpath.
export { canonicalClientType, sameClientType } from "./client-type.js";

/**
 * Endpoint equality: scheme and host compared case-insensitively (with the port), the path
 * without trailing slashes; a value that does not parse as a URL matches nothing.
 */
export function sameEndpoint(a: string, b: string): boolean {
  const norm = (value: string): string | undefined => {
    try {
      const u = new URL(value.trim());
      return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`;
    } catch {
      return undefined;
    }
  };
  const na = norm(a);
  return na !== undefined && na === norm(b);
}

/** What the connection rules read off a model entry: the paired reference, the pinned protocol and the endpoint. */
export interface ModelCredentialShape {
  provider: string;
  modelId: string;
  /** Pinned MMSP client type; blank or absent = the group's, else routed by model id. */
  clientType?: string | undefined;
  /** Inline base URL; blank or absent = the group's, else the routed client's default endpoint. */
  baseUrl?: string | undefined;
}

/** Where an effective connection value came from: the row, its group's table, or nowhere. */
export type ConnectionSource = "model" | "provider" | "none";

/** A group's `[providers.<id>]` connection as the resolver reads it (providerConnectionShape). */
export interface ProviderConnectionShape {
  baseUrl?: string | undefined;
  clientType?: string | undefined;
  apiKey?: string | undefined;
}

/** The connection a request for one row is built with, and where each value came from. */
export interface EffectiveConnection {
  baseUrl?: string;
  baseUrlSource: ConnectionSource;
  clientType?: string;
  clientTypeSource: ConnectionSource;
  apiKey?: string;
  apiKeySource: ConnectionSource;
}

/** `[providers.<id>]` -> the resolver's shape (snake -> camel); undefined in, undefined out. */
export function providerConnectionShape(
  p: ProviderConnection | undefined,
): ProviderConnectionShape | undefined {
  if (p === undefined) return undefined;
  return { baseUrl: p.base_url, clientType: p.client_type, apiKey: p.api_key };
}

/** The first candidate holding a non-blank value, with its source; blank and absent are the same. */
function firstPresent<S extends string>(
  candidates: ReadonlyArray<readonly [string | undefined, S]>,
): { value?: string; source: S | "none" } {
  for (const [value, source] of candidates) {
    if (value !== undefined && value.trim() !== "") return { value, source };
  }
  return { source: "none" };
}

/** `scheme://host[:port]` of a URL (the port only when not the scheme's default), or undefined when it does not parse. */
function endpointOrigin(value: string): string | undefined {
  try {
    const u = new URL(value.trim());
    return `${u.protocol}//${u.host}`;
  } catch {
    return undefined;
  }
}

/**
 * Whether a group's key reaches a row: a key belongs to the endpoint it was issued for. It
 * reaches the row when the row has no base URL of its own — the row goes where the group's
 * clients go — or when the row's own base URL has the same origin (scheme, host, port) as the
 * group's: rows that sit on another path of the host the group's base URL names share its key.
 * A row with its own base URL in a group that has none, or on another origin, goes somewhere
 * the group's key was not issued for, and gets none: it needs a key of its own.
 *
 * Blank counts as absent on both sides; a base URL that does not parse matches nothing.
 * effectiveConnection applies it, and the counts that ask "how many rows use the group key"
 * (the server's, the models page's) ask here.
 */
export function groupKeyReaches(
  rowBaseUrl: string | undefined,
  groupBaseUrl: string | undefined,
): boolean {
  const own = rowBaseUrl?.trim();
  if (!own) return true;
  const group = groupBaseUrl?.trim();
  if (!group) return false;
  const origin = endpointOrigin(own);
  return origin !== undefined && origin === endpointOrigin(group);
}

/**
 * The connection a row is actually used with — the file's values and nothing else: per field,
 * the first non-blank value of
 *
 *   base_url:    row -> provider -> none
 *   client_type: row -> provider -> none
 *   api_key:     row -> provider (only where groupKeyReaches) -> none
 *
 * where "provider" is the group's `[providers.<id>]` table (providerConnectionShape) and
 * "none" means the client library's own default: no base URL = the routed client's default
 * endpoint (or its `*_BASE_URL` variable), no client type = MMSP routes by the id's family, no
 * key = whatever MMSP's routed client does with none (PRN-021: it reads its `*_API_KEY` for its
 * own default endpoint and refuses any other). client_type passes canonicalClientType.
 *
 * A row's own value always wins over its group's, so a group protocol never overrides the
 * protocol a row stores. Pure and browser-safe: the server's `GET /models`, the models page
 * and the CLI read the same answer.
 */
export function effectiveConnection(
  entry: ModelCredentialShape & { apiKey?: string | undefined },
  group: ProviderConnectionShape | undefined,
): EffectiveConnection {
  const baseUrl = firstPresent([
    [entry.baseUrl, "model"],
    [group?.baseUrl, "provider"],
  ]);
  const clientType = firstPresent([
    [entry.clientType, "model"],
    [group?.clientType, "provider"],
  ]);
  const apiKey = firstPresent([
    [entry.apiKey, "model"],
    [groupKeyReaches(entry.baseUrl, group?.baseUrl) ? group?.apiKey : undefined, "provider"],
  ]);
  return {
    ...(baseUrl.value !== undefined ? { baseUrl: baseUrl.value } : {}),
    baseUrlSource: baseUrl.source,
    ...(clientType.value !== undefined
      ? { clientType: canonicalClientType(clientType.value)! }
      : {}),
    clientTypeSource: clientType.source,
    ...(apiKey.value !== undefined ? { apiKey: apiKey.value } : {}),
    apiKeySource: apiKey.source,
  };
}

/**
 * The key, base URL and client type an MMSP client is built with for a config row — the one
 * function every path shares: Session creation and resume, the vision describer, the
 * connectivity / speed / vision probes and the utility completion. It is effectiveConnection's
 * values, verbatim, with nothing for a field the file leaves empty: MMSP's routed client then
 * applies its own defaults, the environment rule included (see the module comment), and a
 * keyless base URL it refuses surfaces when the client is built, as a ModelCredentialError
 * (llm/model-client.ts).
 *
 * `override` is the caller's explicit pair (Session creation's apiKey / baseUrl) and sits above
 * the row's own values; blank counts as absent there too. An override base URL is the row's
 * own, for groupKeyReaches as for everything else.
 */
export function resolveEntryCredential(
  entry: Pick<ModelEntry, "provider" | "model_id" | "client_type" | "base_url" | "api_key">,
  group: ProviderConnectionShape | undefined,
  override: { apiKey?: string | undefined; baseUrl?: string | undefined } = {},
): { apiKey?: string; baseUrl?: string; clientType?: string } {
  const effective = effectiveConnection(
    {
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: entry.client_type,
      baseUrl: override.baseUrl?.trim() ? override.baseUrl : entry.base_url,
      apiKey: override.apiKey?.trim() ? override.apiKey : entry.api_key,
    },
    group,
  );
  return {
    ...(effective.apiKey !== undefined ? { apiKey: effective.apiKey } : {}),
    ...(effective.baseUrl !== undefined ? { baseUrl: effective.baseUrl } : {}),
    ...(effective.clientType !== undefined ? { clientType: effective.clientType } : {}),
  };
}
