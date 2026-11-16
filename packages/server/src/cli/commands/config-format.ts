/**
 * `penguin config model list` formatting: the groups' stored connections, then every model's
 * effective values, as column-aligned lines. Read from the file alone; shared by the command
 * and its unit tests.
 */
import {
  effectiveConnection,
  providerConnectionShape,
  type ProviderConnection,
  type ConnectionSource,
  type EffectiveConnection,
  type ModelEntry,
  type ProjectConfig,
} from "@prismshadow/penguin-core";

import { modelEnvPreviewKey } from "../../model-catalog/env-keys.js";
import { maskApiKey } from "../i18n.js";

function alignColumns<K extends string>(
  cells: ReadonlyArray<Record<K, string>>,
  columns: readonly K[],
): string[] {
  const widths = columns.map((c) => Math.max(...cells.map((cell) => cell[c].length)));
  const active = columns
    .map((c, i) => ({ key: c, width: widths[i]! }))
    .filter((col) => col.width > 0);
  return cells.map((cell) =>
    active
      .map((col, i) => (i === active.length - 1 ? cell[col.key] : cell[col.key].padEnd(col.width)))
      .join("  ")
      .trimEnd(),
  );
}

/** ` (provider)` after a value the row takes from its group's `[providers.<id>]`; nothing otherwise. */
function sourceMark(source: ConnectionSource): string {
  return source === "provider" ? " (provider)" : "";
}

/**
 * The key a row is used with, masked: its own, its group's (marked `(provider)`), or — with
 * neither — the variable MMSP's routed client reads (modelEnvPreviewKey, which the server's
 * preview reads too: only for no base URL or the client's own default endpoint), marked `(env)`
 * when that variable is set. `-` when there is none.
 */
function displayedKey(
  entry: ModelEntry,
  effective: EffectiveConnection,
  group: ProviderConnection | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (effective.apiKeySource !== "none") {
    return `${maskApiKey(effective.apiKey)}${sourceMark(effective.apiKeySource)}`;
  }
  const envKey = modelEnvPreviewKey(
    {
      provider: entry.provider,
      modelId: entry.model_id,
      clientType: entry.client_type,
      baseUrl: entry.base_url,
      apiKey: entry.api_key,
    },
    providerConnectionShape(group),
  );
  const value = envKey !== undefined ? env[envKey]?.trim() : undefined;
  return value ? `${maskApiKey(value)} (env)` : maskApiKey(undefined);
}

/**
 * Renders the model list as column-aligned lines (the default model is marked with `*`;
 * fully empty columns are omitted automatically). `provider` and `model_id` each occupy
 * their own column (stored fields, never split apart); `vision` is the entry's annotation,
 * Y when absent (absent = supported; the catalog is not consulted). `client_type`, `api_key`
 * and `base_url` are the values the model is actually used with (effectiveConnection: the
 * row's own, else its group's, else none — the client's default); one taken from the group is
 * suffixed `(provider)`, and a key lent by the environment `(env)`. Exported for unit tests.
 */
export function formatModelRows(
  cfg: ProjectConfig,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const cells = cfg.models.map((entry) => {
    const isDefault =
      cfg.default_model?.provider === entry.provider &&
      cfg.default_model?.model_id === entry.model_id;
    const effective = effectiveConnection(
      {
        provider: entry.provider,
        modelId: entry.model_id,
        clientType: entry.client_type,
        baseUrl: entry.base_url,
        apiKey: entry.api_key,
      },
      providerConnectionShape(cfg.providers?.[entry.provider]),
    );
    return {
      provider: `${isDefault ? "* " : "  "}${entry.provider}`,
      model: entry.model_id,
      vision: `vision=${entry.vision === false ? "-" : "Y"}`,
      context_window:
        entry.context_window !== undefined ? `context_window=${entry.context_window}` : "",
      client_type: effective.clientType
        ? `client_type=${effective.clientType}${sourceMark(effective.clientTypeSource)}`
        : "",
      pricing: entry.pricing
        ? `price=${entry.pricing.cache_read}/${entry.pricing.cache_write}/${entry.pricing.output}`
        : "",
      api_key: `api_key=${displayedKey(entry, effective, cfg.providers?.[entry.provider], env)}`,
      base_url: effective.baseUrl
        ? `base_url=${effective.baseUrl}${sourceMark(effective.baseUrlSource)}`
        : "",
    };
  });
  return alignColumns(cells, [
    "provider",
    "model",
    "vision",
    "context_window",
    "client_type",
    "pricing",
    "api_key",
    "base_url",
  ]);
}

/**
 * Renders the stored group connections (`[providers.<id>]`) as column-aligned lines: the
 * group id, then its base_url, client_type and key masked, each `-` when the group stores
 * none — `model list` prints them above the models. Only what the file stores: the catalog's
 * reference values are not shown. Exported for unit tests.
 */
export function formatGroupRows(cfg: ProjectConfig): string[] {
  const shown = (value: string | undefined): string => value?.trim() || "-";
  const cells = Object.entries(cfg.providers ?? {}).map(([id, connection]) => ({
    provider: id,
    base_url: `base_url=${shown(connection.base_url)}`,
    client_type: `client_type=${shown(connection.client_type)}`,
    api_key: `api_key=${maskApiKey(connection.api_key?.trim() || undefined)}`,
  }));
  return alignColumns(cells, ["provider", "base_url", "client_type", "api_key"]);
}

/** A group name of the user's own: a lowercase letter or digit first, then lowercase letters, digits, `-` and `_`, at most 32 characters. */
