/**
 * A row's connection as the models page reads it: the values the row stores itself, the ones it
 * inherits from its group's `[providers.<id>]` table, and the key it ends up using.
 *
 * The page keeps a row's OWN base URL, protocol and key in its row state (what the dialog edits
 * and the PUT sends) and the group's stored connection in a map keyed by provider id, both off
 * the same `GET /models`. Everything inherited is derived here with core's effectiveConnection —
 * the function the server resolves a request with — so a draft being typed, a row just saved
 * and the server's own answer cannot disagree about where a value comes from. The file is the
 * only source: a field neither the row nor its group sets is the client's default, and the
 * catalog is never consulted.
 */
import { effectiveConnection, groupKeyReaches } from "@prismshadow/penguin-core/model-catalog";
import type {
  EffectiveConnection,
  ProviderConnectionShape,
} from "@prismshadow/penguin-core/model-catalog";
import type {
  CredentialInfo,
  ProviderConnectionDto,
  ProviderConnectionUpdate,
} from "@prismshadow/penguin-server/api";

/** Every group's stored connection, keyed by provider id (`ModelsResponse.providers`). */
export type ProviderConnections = Readonly<Record<string, ProviderConnectionDto>>;

/**
 * A group's stored connection in the resolver's shape. The page never holds the group's key, so
 * its mask stands in for it: the resolver only asks whether one is there.
 */
export function groupShape(
  group: ProviderConnectionDto | undefined,
): ProviderConnectionShape | undefined {
  if (group === undefined) return undefined;
  return { baseUrl: group.baseUrl, clientType: group.clientType, apiKey: group.apiKeyMasked };
}

/**
 * What a row of `provider` would be used with if it stored nothing of its own but `ownBaseUrl`:
 * its group's table, field by field, and nothing beyond it. The base URL decides only whether the
 * group's key reaches the row (core's groupKeyReaches: a row on another origin than the group's
 * endpoint gets none). This is what decides whether a blank field is allowed and what the dialogs
 * say a blank field will use.
 */
export function inheritedConnection(
  provider: string,
  modelId: string,
  group: ProviderConnectionDto | undefined,
  ownBaseUrl = "",
): EffectiveConnection {
  const shape = groupShape(group);
  // The row's own base URL only steers the key: what a blank base URL field follows is the group's.
  const lent =
    shape !== undefined && !groupKeyReaches(ownBaseUrl, shape.baseUrl)
      ? { ...shape, apiKey: undefined }
      : shape;
  return effectiveConnection({ provider, modelId: modelId.trim() }, lent);
}

/**
 * Whether the group holds a key that does NOT reach a row with this base URL of its own: the row
 * points at another origin than the group's endpoint (or the group names none), so the group's
 * key, issued for that endpoint, is not sent there. The model dialog says so where the key field
 * would otherwise read as inheriting it.
 */
export function groupKeyMissesRow(
  ownBaseUrl: string,
  group: ProviderConnectionDto | undefined,
): boolean {
  return Boolean(group?.apiKeyMasked) && !groupKeyReaches(ownBaseUrl, group?.baseUrl);
}

/**
 * The group's table after `update` lands, as `PUT …/models` or `PUT …/models/providers/:id`
 * will store it — so rows written in the same request resolve against what the group is about
 * to hold rather than what it held before (an import writes the group and its rows together).
 */
export function applyProviderUpdate(
  group: ProviderConnectionDto | undefined,
  update: ProviderConnectionUpdate,
): ProviderConnectionDto {
  const next: ProviderConnectionDto = { ...(group ?? {}) };
  if (update.baseUrl === null || update.baseUrl?.trim() === "") delete next.baseUrl;
  else if (update.baseUrl !== undefined) next.baseUrl = update.baseUrl.trim();
  if (update.clientType === null || update.clientType?.trim() === "") delete next.clientType;
  else if (update.clientType !== undefined) next.clientType = update.clientType.trim();
  if (update.clearApiKey) delete next.apiKeyMasked;
  // Only its presence is read here; the server sends the real mask back with the response.
  if (update.apiKey?.trim()) next.apiKeyMasked = "…";
  return next;
}

/** A row as far as its key is concerned (the page's row state is a superset). */
export interface RowKeyLike {
  provider: string;
  modelId: string;
  /** A key typed into the dialog and not saved yet. */
  apiKeyInput: string;
  /** The dialog's "clear the stored key" box: drops the row's OWN key only. */
  clearApiKey: boolean;
  /** The row's own base URL (as typed, in the dialog): it decides whether the group's key reaches it. */
  baseUrl?: string | undefined;
  /** The row's own stored key, masked. */
  credential?: CredentialInfo | undefined;
  /**
   * The environment's key, masked, as GET /models reports it: only for a variable that holds a
   * value, on the row's effective endpoint, and only when neither the row nor its group holds a
   * key.
   */
  envKeyMasked?: string | undefined;
}

/** Where the key a row uses comes from. `typed` is a key in the dialog that is not saved yet. */
export type RowKeySource = "typed" | "model" | "provider" | "env" | "none";

/**
 * The key a row is used with, most specific first: a key typed but not saved, the row's own
 * stored key (unless its clear box is ticked), its group's key where it reaches the row (core's
 * groupKeyReaches: no base URL of its own, or one on the group's origin — custom's key never
 * reaches Atria, which carries its own host), the environment's, or none — the server's resolution order, with the dialog's two unsaved
 * notions in front of it. `masked` is what the card prints; a typed key has no mask yet.
 *
 * The environment's mask counts only where the server reported one, which it does only for a
 * row with no own and no group key: a row whose own key is being cleared therefore falls to its
 * group's key, and otherwise reads as keyless until the save lands and the server answers again.
 */
export function rowKey(
  row: RowKeyLike,
  group: ProviderConnectionDto | undefined,
): { source: RowKeySource; masked?: string } {
  if (row.apiKeyInput.trim() !== "") return { source: "typed" };
  const own = row.credential?.apiKeyMasked;
  if (own && !row.clearApiKey) return { source: "model", masked: own };
  const inherited = inheritedConnection(row.provider, row.modelId, group, row.baseUrl);
  if (inherited.apiKeySource === "provider") {
    return { source: "provider", masked: inherited.apiKey };
  }
  if (row.envKeyMasked) return { source: "env", masked: row.envKeyMasked };
  return { source: "none" };
}

/**
 * How many of a group's rows store a field of their own — a base URL, a key or a protocol in the
 * row itself — which editing the group changes nothing for. Read off the file's fields alone, as
 * the group settings dialog states it.
 */
export function rowsWithOwnConnection(
  rows: ReadonlyArray<{
    clientType: string;
    originalBaseUrl: string;
    credential?: CredentialInfo | undefined;
  }>,
): number {
  return rows.filter(
    (r) =>
      r.clientType.trim() !== "" ||
      r.originalBaseUrl.trim() !== "" ||
      Boolean(r.credential?.apiKeyMasked),
  ).length;
}
