/**
 * The group-connection side of `penguin config model add` / `model remove`: without
 * `--model-id`, the two commands set or drop the group's `[providers.<id>]` table through the
 * server's models HTTP API. The connection flags, their patching, the group-id rule and the
 * refusals both forms share are defined here.
 */
import {
  type ProjectConfig,
  type ProviderConnection,
  type ProviderConnectionPatch,
  groupKeyReaches,
} from "@prismshadow/penguin-core";
import type {
  ModelInfo,
  ModelsResponse,
  ModelUpdateEntry,
  ProviderConnectionResponse,
  ProviderConnectionUpdate,
} from "@prismshadow/penguin-library-model";
import {
  fixedClientType,
  fixedClientTypeRefuses,
  providerInfo,
} from "../../model-catalog/catalog.js";
import { ApiError, ServerClient } from "../client.js";
import { resolveConnection } from "../connection.js";
import type { Messages } from "../i18n.js";

const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const enc = encodeURIComponent;

/** The connection flags `model add` takes in both of its forms. */
export interface ConnectionFlags {
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  clientType?: string;
  clearClientType?: boolean;
}

/** Converts a server `ModelsResponse` into the `ProjectConfig` shape CLI formatters and checks inspect. */
export function projectConfigFromModelsResponse(res: ModelsResponse): ProjectConfig {
  const unshapeMaskedKey = (masked: string): string =>
    masked.length === 9 && masked[4] === "…" ? `000000000${masked.slice(-4)}` : masked;
  const providers: Record<string, ProviderConnection> = {};
  for (const [id, p] of Object.entries(res.providers ?? {})) {
    providers[id] = {
      ...(p.baseUrl !== undefined ? { base_url: p.baseUrl } : {}),
      ...(p.clientType !== undefined ? { client_type: p.clientType } : {}),
      ...(p.apiKeyMasked !== undefined ? { api_key: unshapeMaskedKey(p.apiKeyMasked) } : {}),
      ...(p.createdAt !== undefined ? { created_at: p.createdAt } : {}),
    };
  }
  return {
    ...(res.defaultModel !== undefined
      ? {
          default_model: {
            provider: res.defaultModel.provider,
            model_id: res.defaultModel.modelId,
          },
        }
      : {}),
    ...(res.visionModel !== undefined
      ? {
          vision_model: {
            provider: res.visionModel.provider,
            model_id: res.visionModel.modelId,
          },
        }
      : {}),
    ...(Object.keys(providers).length > 0 ? { providers } : {}),
    models: res.models.map((m) => ({
      provider: m.provider,
      model_id: m.modelId,
      ...(m.displayName !== undefined ? { display_name: m.displayName } : {}),
      ...(m.contextWindow !== undefined ? { context_window: m.contextWindow } : {}),
      ...(m.clientType !== undefined ? { client_type: m.clientType } : {}),
      ...(m.vision !== undefined ? { vision: m.vision } : {}),
      ...(m.maxTokens !== undefined ? { max_tokens: m.maxTokens } : {}),
      ...(m.fastMode !== undefined ? { fast_mode: m.fastMode } : {}),
      ...(m.pricing !== undefined
        ? {
            pricing: {
              unit: "usd_per_mtok" as const,
              cache_read: m.pricing.cacheRead,
              cache_write: m.pricing.cacheWrite,
              output: m.pricing.output,
            },
          }
        : {}),
      ...(m.credential?.apiKeyMasked !== undefined
        ? { api_key: unshapeMaskedKey(m.credential.apiKeyMasked) }
        : {}),
      ...(m.credential?.baseUrl !== undefined ? { base_url: m.credential.baseUrl } : {}),
      ...(m.credential?.createdAt !== undefined ? { created_at: m.credential.createdAt } : {}),
    })),
  };
}

/** Shapes one `ModelInfo` back into a `ModelUpdateEntry` for `PUT /api/projects/:p/models` (preserves stored key by omitting `apiKey`). */
export function toModelUpdateEntry(m: ModelInfo): ModelUpdateEntry {
  return {
    provider: m.provider,
    modelId: m.modelId,
    ...(m.displayName !== undefined ? { displayName: m.displayName } : {}),
    ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
    ...(m.clientType !== undefined ? { clientType: m.clientType } : {}),
    ...(m.vision !== undefined ? { vision: m.vision } : {}),
    ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
    ...(m.fastMode !== undefined ? { fastMode: m.fastMode } : {}),
    ...(m.pricing !== undefined ? { pricing: m.pricing } : {}),
    ...(m.discount !== undefined ? { discount: m.discount } : {}),
    ...(m.credential?.baseUrl !== undefined ? { baseUrl: m.credential.baseUrl } : {}),
  };
}

/**
 * The connection flags as a patch, the same for a group and for one model: per field, a value
 * sets it, its `--clear-*` flag clears it (`null`), and neither leaves it alone. A field both
 * set and cleared is refused, and so is a blank value — an agent with no key to pass must not
 * wipe the one stored; clearing takes the explicit flag. Returns the refusal sentence instead
 * of a patch.
 */
export function connectionPatch(
  opts: ConnectionFlags,
  t: Messages,
): { patch: ProviderConnectionPatch } | { refusal: string } {
  const patch: ProviderConnectionPatch = {};
  const fields = [
    ["api_key", "--api-key", "--clear-api-key", opts.apiKey, opts.clearApiKey],
    ["base_url", "--base-url", "--clear-base-url", opts.baseUrl, opts.clearBaseUrl],
    ["client_type", "--client-type", "--clear-client-type", opts.clientType, opts.clearClientType],
  ] as const;
  for (const [field, flag, clearFlag, value, clear] of fields) {
    if (value !== undefined && clear === true) {
      return { refusal: t.providerFlagConflict(flag, clearFlag) };
    }
    if (value !== undefined && String(value).trim() === "") {
      return { refusal: t.providerBlankValue(flag, clearFlag) };
    }
    if (value !== undefined) patch[field] = String(value);
    else if (clear === true) patch[field] = null;
  }
  return { patch };
}

/** Whether a string is an absolute http(s) URL: the rule the server applies to a group's base URL. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Writes a refusal to stderr and sets a failing exit code; nothing is written to the config. */
export function refuse(t: Messages, message: string): void {
  process.stderr.write(`${t.error(message)}\n`);
  process.exitCode = 1;
}

export function refuseErr(t: Messages, err: unknown): void {
  refuse(
    t,
    err instanceof ApiError && err.detail
      ? err.detail
      : err instanceof Error
        ? err.message
        : String(err),
  );
}

export async function configClient(
  opts: { server?: string; root?: string },
  t: Messages,
): Promise<ServerClient> {
  return new ServerClient(await resolveConnection({ server: opts.server, root: opts.root }, t), t);
}

/**
 * `model add` without `--model-id`: sets or clears the group's connection
 * (`[providers.<group>]`), which the group's models without a value of their own follow. The
 * flags that describe one model are refused rather than dropped, and so is a call that changes
 * nothing.
 */
export async function addGroupConnection(
  opts: ConnectionFlags & {
    provider: string;
    projectId: string;
    server?: string;
    root?: string;
    contextWindow?: number;
    maxTokens?: number;
    vision?: boolean;
    fastMode?: boolean;
    priceCacheRead?: number;
    priceCacheWrite?: number;
    priceOutput?: number;
    setDefault?: boolean;
  },
  t: Messages,
): Promise<void> {
  const group = String(opts.provider).trim();
  const rowOnly =
    opts.contextWindow !== undefined ||
    opts.maxTokens !== undefined ||
    opts.vision !== undefined ||
    opts.fastMode !== undefined ||
    opts.priceCacheRead !== undefined ||
    opts.priceCacheWrite !== undefined ||
    opts.priceOutput !== undefined ||
    opts.setDefault === true;
  if (rowOnly) {
    refuse(t, t.modelGroupOnlyFlags(group));
    return;
  }
  const parsed = connectionPatch(opts, t);
  if ("refusal" in parsed) {
    refuse(t, parsed.refusal);
    return;
  }
  const { patch } = parsed;
  if (Object.keys(patch).length === 0) {
    refuse(t, t.providerNothingToSet(group));
    return;
  }
  if (typeof patch.base_url === "string" && !isHttpUrl(patch.base_url.trim())) {
    refuse(t, t.providerInvalidBaseUrl(patch.base_url));
    return;
  }
  const client = await configClient(opts, t);
  const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
  const before = projectConfigFromModelsResponse(
    await client.request<ModelsResponse>("GET", modelsPath),
  );
  if (
    !GROUP_ID.test(group) &&
    providerInfo(group) === undefined &&
    !before.models.some((m) => m.provider === group)
  ) {
    refuse(t, t.providerInvalidGroup(group));
    return;
  }
  if (
    patch.client_type !== undefined &&
    fixedClientTypeRefuses(
      group,
      "group",
      patch.client_type,
      before.providers?.[group]?.client_type,
    )
  ) {
    refuse(t, t.protocolFixed(providerInfo(group)?.label ?? group, fixedClientType(group)!));
    return;
  }
  const body: ProviderConnectionUpdate = {
    ...(patch.api_key !== undefined
      ? patch.api_key === null
        ? { clearApiKey: true }
        : { apiKey: patch.api_key.trim() }
      : {}),
    ...(patch.base_url !== undefined ? { baseUrl: patch.base_url } : {}),
    ...(patch.client_type !== undefined ? { clientType: patch.client_type } : {}),
  };
  let cfg: ProjectConfig;
  try {
    const res = await client.request<ProviderConnectionResponse>(
      "PUT",
      `${modelsPath}/providers/${enc(group)}`,
      body,
    );
    cfg = projectConfigFromModelsResponse(res);
  } catch (err) {
    refuseErr(t, err);
    return;
  }
  const groupBaseUrl = cfg.providers?.[group]?.base_url;
  const rows = cfg.models.filter((m) => m.provider === group);
  const own = (value: string | undefined): boolean => (value ?? "").trim() !== "";
  const overriding = rows.filter(
    (m) =>
      (patch.api_key !== undefined &&
        (own(m.api_key) || !groupKeyReaches(m.base_url, groupBaseUrl))) ||
      (patch.base_url !== undefined && own(m.base_url)) ||
      (patch.client_type !== undefined && own(m.client_type)),
  ).length;
  process.stdout.write(`${t.providerSaved(group, overriding)}\n`);
  if (rows.length === 0 && providerInfo(group) === undefined) {
    process.stdout.write(`${t.providerNoModels(group)}\n`);
  }
}

/**
 * `model remove` without `--model-id`: drops the group's `[providers.<group>]` table, every
 * field of it, and leaves its models alone — the only way to delete models stays one pair at a
 * time. A group with no table is refused, pointing at `--model-id`.
 */
export async function removeGroupConnection(
  opts: { provider: string; projectId: string; server?: string; root?: string },
  t: Messages,
): Promise<void> {
  const group = String(opts.provider).trim();
  const client = await configClient(opts, t);
  const modelsPath = `/api/projects/${enc(opts.projectId)}/models`;
  const before = projectConfigFromModelsResponse(
    await client.request<ModelsResponse>("GET", modelsPath),
  );
  if (before.providers?.[group] === undefined) {
    refuse(t, t.providerNothingToRemove(group));
    return;
  }
  await client.request<ProviderConnectionResponse>("PUT", `${modelsPath}/providers/${enc(group)}`, {
    clearApiKey: true,
    baseUrl: null,
    clientType: null,
  });
  const rows = before.models.filter((m) => m.provider === group).length;
  process.stdout.write(`${t.providerRemoved(group, rows)}\n`);
}
