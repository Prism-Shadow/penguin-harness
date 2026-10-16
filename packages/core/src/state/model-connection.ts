/**
 * How a Project config row is connected: its effective connection (row -> group -> none, per
 * field), and the credential an MMSP client is built with for it.
 *
 * Everything here is decided from the Project config alone. Core knows no model, provider
 * group, vendor host or endpoint: the built-in catalog lives in the server package and reaches
 * core only through the file it seeds (`[providers.<id>]`, `[[models]]`) or through host hooks.
 * What core does know is MMSP's client-type table (MMSP_CLIENTS): which variable prefix each
 * client reads and which one calls an open server keyless. That is protocol knowledge, not
 * model knowledge.
 *
 * The environment rule (PRN-021): a row with no key of its own and no group key that reaches it
 * may use a vendor's environment variable only when its group is marked `official = true` (the
 * group's endpoint is its vendor's own) and the row names no base URL of its own. Every other
 * keyless row is refused, except on an open MMSP server.
 *
 * This file imports no Node built-ins (type-only imports only), so the Web App bundles it
 * through the `@prismshadow/penguin-core/model-connection` subpath.
 */
import type { ModelEntry, ProviderConnection } from "./project-config.js";

/**
 * The wire protocol that carries MMSP's `fast_mode` on a client: `"openai"` for the clients
 * that send `service_tier: "priority"` (the OpenAI protocols, and Google's Interactions API
 * and MiniMax alike), `"anthropic"` for those that send `speed: "fast"` plus the
 * `fast-mode-2026-02-01` beta header. The two differ in what the user must be warned about,
 * not just in wire shape.
 */
export type FastModeProtocol = "openai" | "anthropic";

/**
 * What the harness mirrors about each MMSP client, in one place: the environment variable
 * prefix it reads its key and base URL from when handed none (an official client its vendor's,
 * a compatible client the vendor's whose wire protocol it speaks), the path it appends to its
 * base URL, the protocol that carries `fast_mode` (absent = the client rejects it, or the
 * harness cannot tell what it does with it), and `openServer` for a client that calls a base
 * URL handed no key with no key at all where every other client refuses it (see
 * keylessEndpoint). A client type this table does not name is one MMSP does not have either.
 */
export const MMSP_CLIENTS: Readonly<
  Record<string, { env: string; path: string; fastMode?: FastModeProtocol; openServer?: true }>
> = {
  "openai-official": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "anthropic-official": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  // compat: MMSP 0.5.2 keeps google-official's earlier name as an alias, and a Project written
  // before it may still pin it, never rewritten; this row goes with the MMSP upgrade that drops
  // the alias (changelog/0.2.15/2026-10-10-backward-compatibility.md).
  "gemini-official": { env: "GEMINI", path: "/v1beta/interactions", fastMode: "openai" },
  "zai-official": { env: "ZAI", path: "/chat/completions" },
  "moonshot-official": { env: "MOONSHOT", path: "/chat/completions" },
  "deepseek-official": { env: "DEEPSEEK", path: "/responses" },
  "minimax-official": { env: "MINIMAX", path: "/responses", fastMode: "openai" },
  "openai-responses": { env: "OPENAI", path: "/responses", fastMode: "openai" },
  "openai-chat": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-chat-vllm-adapter": { env: "OPENAI", path: "/chat/completions", fastMode: "openai" },
  "openai-embedding": { env: "OPENAI", path: "/embeddings" },
  "ant-messages": { env: "ANTHROPIC", path: "/v1/messages", fastMode: "anthropic" },
  "google-genai": { env: "GEMINI", path: "/v1beta/models" },
  // MMSP 0.5.1 keeps the 0.5.0 name of google-genai as an alias.
  "gemini-generate-content": { env: "GEMINI", path: "/v1beta/models" },
  // An MMSP server: the client posts to {base}/stream. It forwards `fast_mode` to the server,
  // whose upstream client decides, so the harness offers no toggle it cannot vouch for.
  mmsp: { env: "MMSP", path: "/stream", openServer: true },
};

/**
 * Canonical spelling of an MMSP client-type string. The generic Chat Completions client was
 * renamed from `openai` to `openai-chat` (AgentHub 0.4.2); the bare `openai` spelling still
 * routes upstream as a deprecated alias, but the harness converges on the canonical name —
 * config reads/writes and API request handling all normalize through here, so configs saved
 * before the rename keep working while comparisons (legacy-protocol display, catalog sync)
 * see one spelling. Any other value (including `openai-responses` / `openai-embedding`,
 * which merely contain "openai") passes through unchanged.
 */
export function canonicalClientType(clientType: string | undefined): string | undefined {
  if (clientType === undefined) return undefined;
  return clientType.trim().toLowerCase() === "openai" ? "openai-chat" : clientType;
}

/** The MMSP_CLIENTS row a client type names (canonical spelling, case and space ignored), or undefined. */
export function mmspClient(
  clientType: string | undefined,
): (typeof MMSP_CLIENTS)[string] | undefined {
  const name = canonicalClientType(clientType?.trim() || undefined)?.toLowerCase();
  return name !== undefined && Object.hasOwn(MMSP_CLIENTS, name) ? MMSP_CLIENTS[name] : undefined;
}

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

/** Client-type equality as routing sees it: canonical spelling (canonicalClientType), case and surrounding space ignored. */
export function sameClientType(a: string, b: string): boolean {
  const norm = (value: string): string => canonicalClientType(value.trim())!.toLowerCase();
  return norm(a) === norm(b);
}

/**
 * A model entry that cannot be given to an MMSP client as configured: no key, and no
 * environment variable it may use. The message names the model and what to do, and says
 * "API key" so hosts that classify credential errors by message (the server's
 * `isMissingCredential`) file it with the SDKs' own missing-credential errors.
 */
export class ModelCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelCredentialError";
  }
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
  /**
   * `true`: the group's endpoint is its vendor's own, so a keyless row that names no base URL
   * of its own may use the vendor's environment variable (environmentKeyRoute). Anything else
   * lends nothing.
   */
  official?: boolean | undefined;
}

/** The connection a request for one row is built with, and where each value came from. */
export interface EffectiveConnection {
  baseUrl?: string;
  baseUrlSource: ConnectionSource;
  clientType?: string;
  clientTypeSource: ConnectionSource;
  apiKey?: string;
  /** No "env" here: whether the environment lends a key is environmentKeyRoute's call. */
  apiKeySource: ConnectionSource;
}

/** `[providers.<id>]` -> the resolver's shape (snake -> camel); undefined in, undefined out. */
export function providerConnectionShape(
  p: ProviderConnection | undefined,
): ProviderConnectionShape | undefined {
  if (p === undefined) return undefined;
  return {
    baseUrl: p.base_url,
    clientType: p.client_type,
    apiKey: p.api_key,
    ...(p.official !== undefined ? { official: p.official } : {}),
  };
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
 * endpoint (or its `*_BASE_URL` variable), no client type = MMSP routes by the id's family,
 * no key = the environment, where environmentKeyRoute allows it. client_type passes
 * canonicalClientType.
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
 * Whether a keyless request to this base URL goes out with no key rather than being refused:
 * MMSP's mmsp client calls a base URL it is handed without a key as an open MMSP server (the
 * `openServer` clients of MMSP_CLIENTS). An id routed by its family never reaches that client,
 * so the pinned (effective) client type alone decides.
 */
export function keylessEndpoint(
  clientType: string | undefined,
  baseUrl: string | undefined,
): boolean {
  return Boolean(baseUrl?.trim()) && mmspClient(clientType)?.openServer === true;
}

/**
 * How a keyless row may use the environment (PRN-021), or undefined when it may not:
 *
 * - `client`: the routed MMSP client reads its own variable pair — hand it nothing, so the
 *   client's own lookup, a `*_BASE_URL` the user set beside the key, and the client's own error
 *   when the variable is unset all apply unchanged;
 * - `explicit`: the harness reads `envKey` and passes its value, because MMSP refuses a base URL
 *   handed no key rather than lend its variable to it;
 * - `unnamed`: the row could use the environment, but its group names no client type, so no
 *   variable belongs to the group's base URL;
 * - `foreign`: the row's own client type reads another variable than its group's (another
 *   vendor's key, which must not travel to this group's endpoint), or one MMSP does not have.
 */
export type EnvironmentKeyRoute =
  | { kind: "client" }
  | { kind: "explicit"; envKey: string }
  | { kind: "unnamed" }
  | { kind: "foreign"; clientType: string };

/**
 * PRN-021's environment rule, decided from the Project config alone. A row with no key of its
 * own and no group key that reaches it may use the environment only when its group is marked
 * `official = true` and the row names no base URL of its own (an override base URL counts as
 * the row's own):
 *
 * - the group has no base URL either: `client` — the routed client reads its own variable and
 *   goes to its own vendor's default endpoint, whatever protocol the row pins;
 * - the group has a base URL: `explicit` with the variable the group's client type reads, but
 *   only when the row's effective client type (its own, else the group's) reads that same
 *   variable — the same MMSP_CLIENTS `env` prefix. A row pinned to a client that reads another
 *   variable is `foreign`: that variable belongs to another vendor's endpoint, not this group's.
 *   A group with no client type, or one MMSP does not have, is `unnamed`.
 *
 * Every other row — a group that is not official, a row pointed at its own endpoint — is
 * lent nothing: undefined. `entry` is the row's OWN values, not its effective ones. Only core's
 * client table is consulted; no vendor is named.
 */
export function environmentKeyRoute(
  entry: { baseUrl?: string | undefined; clientType?: string | undefined },
  group: ProviderConnectionShape | undefined,
): EnvironmentKeyRoute | undefined {
  if (group?.official !== true || entry.baseUrl?.trim()) return undefined;
  if (!group.baseUrl?.trim()) return { kind: "client" };
  const groupClient = mmspClient(group.clientType);
  if (groupClient === undefined) return { kind: "unnamed" };
  const own = entry.clientType?.trim();
  if (own && mmspClient(own)?.env !== groupClient.env) return { kind: "foreign", clientType: own };
  return { kind: "explicit", envKey: `${groupClient.env}_API_KEY` };
}

/**
 * The credential and protocol an MMSP client is built with for a config row: its effective
 * connection, and for a row with no key the environment rule (environmentKeyRoute) — the one
 * function every path shares: Session creation and resume, the vision describer, the
 * connectivity / speed / vision probes and the utility completion.
 *
 * - A key on the row, or the group's key that reaches it (or the caller's override), is used
 *   as written.
 * - No key, official group, no base URL anywhere: nothing is handed over and the routed client
 *   reads its own variable pair — including the SDK's own error when the variable is unset.
 * - No key, official group with a base URL: the variable the group's client type reads is passed
 *   explicitly, to a row whose effective client type reads the same one; an unset variable, a
 *   group with no client type to name one, and a row pinned to a client that reads another
 *   vendor's variable are refused here.
 * - No key on the mmsp client with a base URL (keylessEndpoint): the base URL alone, so the
 *   client sends no key, which an open MMSP server takes — as MMSP itself does.
 * - Any other keyless row is refused with a ModelCredentialError before any client exists.
 *
 * `override` is the caller's explicit pair (Session creation's apiKey / baseUrl) and sits above
 * the row's own values; blank counts as absent there too. An override base URL is the row's
 * own, for groupKeyReaches and for the environment rule alike.
 */
export function resolveEntryCredential(
  entry: Pick<ModelEntry, "provider" | "model_id" | "client_type" | "base_url" | "api_key">,
  provider: ProviderConnectionShape | undefined,
  override: { apiKey?: string | undefined; baseUrl?: string | undefined } = {},
  env: Readonly<Record<string, string | undefined>> = process.env,
): { apiKey?: string; baseUrl?: string; clientType?: string } {
  const own = {
    provider: entry.provider,
    modelId: entry.model_id,
    clientType: entry.client_type,
    baseUrl: override.baseUrl?.trim() ? override.baseUrl : entry.base_url,
    apiKey: override.apiKey?.trim() ? override.apiKey : entry.api_key,
  };
  const effective = effectiveConnection(own, provider);
  const connection = {
    ...(effective.baseUrl !== undefined ? { baseUrl: effective.baseUrl } : {}),
    ...(effective.clientType !== undefined ? { clientType: effective.clientType } : {}),
  };
  if (effective.apiKey !== undefined) return { apiKey: effective.apiKey, ...connection };
  const ref = `${entry.provider}/${entry.model_id}`;
  const route = environmentKeyRoute(own, provider);
  if (route?.kind === "client") return connection;
  if (route?.kind === "explicit") {
    const value = env[route.envKey]?.trim();
    if (!value) {
      throw new ModelCredentialError(
        `Model ${ref} has no API key: set one on the model entry or its group, or set ${route.envKey} in the server environment.`,
      );
    }
    return { apiKey: value, ...connection };
  }
  if (route?.kind === "unnamed") {
    throw new ModelCredentialError(
      `Model ${ref} has no API key, and its group's base URL comes with no protocol that names an environment variable: set the API key on the model entry or its group, or set the group's protocol.`,
    );
  }
  if (route?.kind === "foreign") {
    throw new ModelCredentialError(
      `Model ${ref} has no API key. Its protocol (${route.clientType}) reads another environment variable than its group's, and that key does not go to the group's endpoint: set the API key on the model entry.`,
    );
  }
  if (keylessEndpoint(effective.clientType, effective.baseUrl)) return connection;
  // A Bedrock region on the entry is not "not the vendor's": it is AWS, whose usual
  // credential is the default provider chain rather than a key. Until MMSP stops letting its
  // Bedrock client attach ANTHROPIC_API_KEY, a keyless row here is refused, and the message
  // says what still works.
  const baseUrl = effective.baseUrl?.trim();
  if (baseUrl?.toLowerCase().startsWith("bedrock://")) {
    throw new ModelCredentialError(
      `Model ${ref} has no API key. A Bedrock endpoint set on the model entry cannot fall back to the environment yet: set the entry's AWS key (access,secret), or leave its base URL empty and set ANTHROPIC_BASE_URL=${baseUrl} in the server environment.`,
    );
  }
  throw new ModelCredentialError(
    provider?.official === true
      ? `Model ${ref} has no API key. It names a base URL of its own, so no environment variable is used for it: set the API key on the model entry.`
      : `Model ${ref} has no API key. Its group is not marked official (its endpoint is not the vendor's own), so no environment variable is used for it: set the API key on the model entry or its group.`,
  );
}
