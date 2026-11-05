/**
 * The catalog as a Project config seeds it: each built-in group's `[providers.<id>]` table, the
 * preset rows (storing a protocol or endpoint only where it differs from the table beside it),
 * the default model and the flat promotions — what the server writes when a Project is created,
 * on "Add new models" and on "Restore defaults". Reference values: nothing reads them when a
 * request is built.
 */
import type { ModelEntry, ModelRef, ProviderTable } from "@prismshadow/penguin-core";
import {
  canonicalClientType,
  sameClientType,
  sameEndpoint,
} from "@prismshadow/penguin-core/model-connection";
import { MODEL_CATALOG, MODEL_PROVIDERS, providerClientType, providerInfo } from "./catalog.js";
import type { ModelCatalogEntry } from "./catalog.js";

/**
 * The value every one of `values` holds, by `same`, or undefined when one lacks it, two
 * differ, or there are none.
 */
function sharedValue(
  values: readonly (string | undefined)[],
  same: (a: string, b: string) => boolean,
): string | undefined {
  const first = values[0];
  if (first === undefined) return undefined;
  return values.every((v) => v !== undefined && same(v, first)) ? first : undefined;
}

/**
 * The connection the catalog gives a built-in group when a file is written from it — a new
 * Project, "Add new models" for a group new to the file, "Restore defaults": its gateway
 * endpoint (`gatewayBaseUrl`, else the one base URL every catalog row of the group carries)
 * and its one protocol (the group's pin, providerClientType, else the one pin every catalog
 * row of the group carries; canonical spelling). Retired rows count: the Projects that still
 * carry one store its difference from the same table.
 *
 * Undefined for `custom` (it holds the user's own endpoints), for an id the catalog does not
 * know, and for a group with neither — the first-party vendors, whose rows go to the
 * client's defaults, so their keyless rows are handed no key and MMSP's client reads the
 * vendor's environment variable (PRN-021). A reference value: nothing reads it when a request
 * is built.
 */
export function catalogGroupConnection(
  providerId: string,
): { base_url?: string; client_type?: string } | undefined {
  const info = providerInfo(providerId);
  if (info === undefined || info.id === "custom") return undefined;
  const rows = MODEL_CATALOG.filter((m) => m.provider === providerId);
  const baseUrl =
    info.gatewayBaseUrl ??
    sharedValue(
      rows.map((m) => m.baseUrl),
      sameEndpoint,
    );
  const clientType = canonicalClientType(
    providerClientType(providerId) ??
      sharedValue(
        rows.map((m) => m.clientType),
        sameClientType,
      ),
  );
  if (baseUrl === undefined && clientType === undefined) return undefined;
  return {
    ...(baseUrl !== undefined ? { base_url: baseUrl } : {}),
    ...(clientType !== undefined ? { client_type: clientType } : {}),
  };
}

/**
 * The default model of a new Project: DeepSeek V4.1 Flash, which the vendor serves under the
 * bare name `deepseek-flash` — the current generation of the Flash series, at the same price
 * and schedule as the V4 rows it replaces, and it reads images, so a new Project can take a
 * pasted screenshot without anyone having to notice why it could not. The bare id begins with
 * the `deepseek-` family, so MMSP routes it to DeepSeek's official client without a pin. A
 * Project's default is copied in at creation (the server's seed, and "Restore defaults") and
 * owned by it from then on, so this reaches new Projects alone; an existing one keeps whatever
 * it stored, and "Add new models" never touches the stored default. Its catalog row carries
 * `wasDefault`, as every former default's does.
 */
export const PRESET_DEFAULT_MODEL: Readonly<ModelRef> = {
  provider: "deepseek",
  model_id: "deepseek-flash",
};

/**
 * `[providers.<id>]` for every built-in group with a catalogGroupConnection, in the catalog's
 * group order — what a new Project's file stores beside presetModelEntries' rows. A fresh
 * object on every call, so a caller may change it.
 */
export function presetProviderTable(): ProviderTable {
  const table: ProviderTable = {};
  for (const p of MODEL_PROVIDERS) {
    const connection = catalogGroupConnection(p.id);
    if (connection !== undefined) table[p.id] = connection;
  }
  return table;
}

/**
 * Catalog -> preset ModelEntry list (what the server seeds a new Project with and what
 * "Add new models" and "Restore defaults" write, avoiding duplicate hand-written copies). `provider` and `model_id` are persisted as
 * separate fields (`model_id` is the plain upstream id). The facts a row stores are the
 * context window, the price and `vision = false`, plus the row's protocol and endpoint where
 * they differ from its group's table in `groups` (catalogModelEntry): beside those tables, the
 * file alone says where every request goes, and nothing is left for a resolver to fill from
 * the catalog. `groups` is the `[providers]` table the rows will sit beside — a new Project's
 * (presetProviderTable, the default), or the file's own when "Add new models" adds rows to an
 * existing Project, so each added row resolves to its catalog connection whatever the user
 * has set on its group. No secrets are included, so only an API key is needed.
 *
 * Pricing is written as the LIST price the catalog records (a scheduled row's PEAK price),
 * never a discounted number. What is on disk then stays true whatever promotion is live and
 * whatever hour the Project is created or re-synced in: a flat promotion is stored beside the
 * file as a per-Project fraction (presetPromotions), and both it and an off-peak tier are
 * applied when the price is read, by the models page and by the cost center alike.
 */
export function presetModelEntries(groups: ProviderTable = presetProviderTable()): ModelEntry[] {
  const catalog = presetProviderTable();
  // A retired row stays in the catalog for the Projects that still carry it, and only for them.
  return MODEL_CATALOG.filter((m) => m.retired !== true).map((m) =>
    catalogModelEntry(m, catalog, groups),
  );
}

/**
 * Every catalog row as a ModelEntry, retired rows included, in the shape presetModelEntries
 * writes: what a Project carrying a retired row stores for it beside a new Project's group
 * tables (see ModelCatalogEntry.retired). `groups` as in presetModelEntries.
 */
export function catalogModelEntries(groups: ProviderTable = presetProviderTable()): ModelEntry[] {
  const catalog = presetProviderTable();
  return MODEL_CATALOG.map((m) => catalogModelEntry(m, catalog, groups));
}

/**
 * One catalog row as the ModelEntry a Project stores (see presetModelEntries): its facts, and
 * `client_type` / `base_url` exactly where the row's catalog connection — per field, the
 * row's own catalog value, else its group's (`catalog`, presetProviderTable) — differs from
 * the table it will sit beside (`groups`): canonical client types compared, endpoints by
 * sameEndpoint, a blank table field counting as absent. A row whose group's table carries the
 * same value stores none and follows the table; a row whose group has no table (custom's
 * Atria) stores its own.
 */
function catalogModelEntry(
  m: ModelCatalogEntry,
  catalog: ProviderTable,
  groups: ProviderTable,
): ModelEntry {
  const group = groups[m.provider];
  const clientType = canonicalClientType(m.clientType ?? catalog[m.provider]?.client_type);
  const groupClientType = group?.client_type?.trim() || undefined;
  const ownClientType =
    clientType !== undefined &&
    (groupClientType === undefined || !sameClientType(clientType, groupClientType))
      ? clientType
      : undefined;
  const baseUrl = m.baseUrl ?? catalog[m.provider]?.base_url;
  const groupBaseUrl = group?.base_url?.trim() || undefined;
  const ownBaseUrl =
    baseUrl !== undefined && (groupBaseUrl === undefined || !sameEndpoint(baseUrl, groupBaseUrl))
      ? baseUrl
      : undefined;
  return {
    provider: m.provider,
    model_id: m.modelId,
    ...(m.contextWindow !== undefined ? { context_window: m.contextWindow } : {}),
    ...(ownClientType !== undefined ? { client_type: ownClientType } : {}),
    ...(m.pricing ? { pricing: { ...m.pricing } } : {}),
    // ModelEntry.vision defaults to supported: only models that don't support images
    // explicitly persist false (drives read_file's hand-off of images to the vision model and input
    // image hand-off, see project-config.ts).
    ...(m.supportsVision ? {} : { vision: false }),
    ...(ownBaseUrl !== undefined ? { base_url: ownBaseUrl } : {}),
  };
}

/**
 * The catalog's flat promotions, as a new Project is seeded with them: every row whose `discount`
 * is a fraction in (0, 1). A retired row is skipped like it is in presetModelEntries: a new
 * Project never carries it, so there is nothing for its promotion to apply to.
 */
export function presetPromotions(): Array<{ provider: string; modelId: string; discount: number }> {
  return MODEL_CATALOG.flatMap((m) =>
    m.retired !== true && m.discount !== undefined && m.discount > 0 && m.discount < 1
      ? [{ provider: m.provider, modelId: m.modelId, discount: m.discount }]
      : [],
  );
}
