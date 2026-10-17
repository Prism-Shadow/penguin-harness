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
 * The environment rule (PRN-021): a row with no key in the file whose row and group both name
 * no base URL is handed nothing, and MMSP's routed client reads its own `*_API_KEY` and
 * `*_BASE_URL`, so the key and the endpoint both come from the operator's environment. A row
 * with no key that is sent to a base URL from the file is refused, except on an open MMSP
 * server. Core never reads an environment variable itself.
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
 * A model entry that cannot be given to an MMSP client as configured: no key in the file, and a
 * base URL from the file, so no environment variable is used for it. The message names the
 * model and what to do, and says "API key" so hosts that classify credential errors by message
 * (the server's `isMissingCredential`) file it with the SDKs' own missing-credential errors.
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

/**
 * Where a row's key comes from: the row, its group, the environment, or nowhere. `env` = no key
 * in the file and no base URL anywhere: core hands MMSP nothing and the routed client reads its
 * own `*_API_KEY` (an unset variable is MMSP's own error). `none` = no key in the file and a base
 * URL from the file: nothing is sent, and keylessEndpoint says whether the request still goes out.
 */
export type ApiKeySource = ConnectionSource | "env";

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
  apiKeySource: ApiKeySource;
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
 *   api_key:     row -> provider (only where groupKeyReaches) -> env (no base URL anywhere) -> none
 *
 * where "provider" is the group's `[providers.<id>]` table (providerConnectionShape) and
 * "none" means the client library's own default: no base URL = the routed client's default
 * endpoint (or its `*_BASE_URL` variable), no client type = MMSP routes by the id's family.
 * A row with no key in the file is `env` when no base URL is set anywhere (the routed client
 * reads its own variable pair) and `none` otherwise (see ApiKeySource). client_type passes
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
    apiKeySource:
      apiKey.source !== "none" ? apiKey.source : baseUrl.value === undefined ? "env" : "none",
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
 * The credential and protocol an MMSP client is built with for a config row — the one function
 * every path shares: Session creation and resume, the vision describer, the connectivity /
 * speed / vision probes and the utility completion. It reads effectiveConnection:
 *
 * - A key on the row, or the group's key that reaches it (or the caller's override), is used
 *   as written.
 * - No key, no base URL anywhere (`env`): nothing is handed over and the routed client reads
 *   its own `*_API_KEY` / `*_BASE_URL` pair — including the SDK's own error when the variable
 *   is unset.
 * - No key on the mmsp client with a base URL (keylessEndpoint): the base URL alone, so the
 *   client sends no key, which an open MMSP server takes — as MMSP itself does.
 * - Any other keyless row — sent to a base URL from the file, the vendor's own included — is
 *   refused with a ModelCredentialError before any client exists. The message names the
 *   variable pair only when the row's protocol is pinned: with none, MMSP routes by the id's
 *   family, which core does not know.
 *
 * `override` is the caller's explicit pair (Session creation's apiKey / baseUrl) and sits above
 * the row's own values; blank counts as absent there too. An override base URL is the row's
 * own, for groupKeyReaches and for the environment rule alike.
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
  const connection = {
    ...(effective.baseUrl !== undefined ? { baseUrl: effective.baseUrl } : {}),
    ...(effective.clientType !== undefined ? { clientType: effective.clientType } : {}),
  };
  if (effective.apiKey !== undefined) return { apiKey: effective.apiKey, ...connection };
  if (effective.apiKeySource === "env") return connection;
  if (keylessEndpoint(effective.clientType, effective.baseUrl)) return connection;
  const prefix = mmspClient(effective.clientType)?.env;
  throw new ModelCredentialError(
    `Model ${entry.provider}/${entry.model_id} has no API key. It is sent to ${effective.baseUrl}, so no environment variable is used for it: set the API key on the model entry or its group` +
      (prefix !== undefined
        ? `, or clear the base URL and set ${prefix}_API_KEY (and ${prefix}_BASE_URL=${effective.baseUrl} if that endpoint is not the client's default) in the server environment.`
        : "."),
  );
}
