/**
 * The group-connection side of `penguin config model add` / `model remove`: without
 * `--model-id`, the two commands set or drop the group's `[providers.<id>]` table. The
 * connection flags, their patching, the group-id rule and the refusals both forms share are
 * defined here.
 */
import {
  type ProjectConfig,
  type ProviderConnectionPatch,
  groupKeyReaches,
  loadProjectConfig,
  providerConnectionShape,
  setProviderConnection,
} from "@prismshadow/penguin-core";
import {
  fixedClientType,
  fixedClientTypeRefuses,
  providerInfo,
} from "../../model-catalog/catalog.js";
import type { Messages } from "../i18n.js";
import { resolveRootOption } from "../root-option.js";

const GROUP_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/** The connection flags `model add` takes in both of its forms. */
export interface ConnectionFlags {
  apiKey?: string;
  clearApiKey?: boolean;
  baseUrl?: string;
  clearBaseUrl?: boolean;
  clientType?: string;
  clearClientType?: boolean;
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
  const root = resolveRootOption(opts.root);
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
  // The group-name rule the models page and the server apply; a group some model already
  // names (one `model add` created under another spelling) is let through.
  if (
    !GROUP_ID.test(group) &&
    providerInfo(group) === undefined &&
    !(await loadProjectConfig(root, opts.projectId)).models.some((m) => m.provider === group)
  ) {
    refuse(t, t.providerInvalidGroup(group));
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
  // The server's group routes refuse this too: Penguin Go's protocol is fixed.
  if (
    patch.client_type !== undefined &&
    fixedClientTypeRefuses(
      group,
      "group",
      patch.client_type,
      (await loadProjectConfig(root, opts.projectId)).providers?.[group]?.client_type,
    )
  ) {
    refuse(t, t.protocolFixed(providerInfo(group)?.label ?? group, fixedClientType(group)!));
    return;
  }
  // The group's models without a base URL of their own are all sent here, so a typo would
  // break every one of them at its next request: the check the server's group routes make.
  if (typeof patch.base_url === "string" && !isHttpUrl(patch.base_url.trim())) {
    refuse(t, t.providerInvalidBaseUrl(patch.base_url));
    return;
  }
  let cfg: ProjectConfig;
  try {
    cfg = await setProviderConnection(root, opts.projectId, group, patch);
  } catch (err) {
    refuse(t, err instanceof Error ? err.message : String(err));
    return;
  }
  // Models that keep a value of their own for a changed field are unaffected by it: say how
  // many, so a "why does this model still use the old key" never needs the file to answer. A
  // model whose own base URL is not on the group's endpoint never takes the group key
  // (groupKeyReaches), so a key change passes it by as well.
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
  // A group of the user's own exists only through its models; one with none yet is either
  // about to get them or a typo, and either way the user should know.
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
  opts: { provider: string; projectId: string; root?: string },
  t: Messages,
): Promise<void> {
  const root = resolveRootOption(opts.root);
  const group = String(opts.provider).trim();
  const before = await loadProjectConfig(root, opts.projectId);
  if (before.providers?.[group] === undefined) {
    refuse(t, t.providerNothingToRemove(group));
    return;
  }
  const cfg = await setProviderConnection(root, opts.projectId, group, {
    api_key: null,
    base_url: null,
    client_type: null,
  });
  const models = cfg.models.filter((m) => m.provider === group).length;
  process.stdout.write(`${t.providerRemoved(group, models)}\n`);
}
