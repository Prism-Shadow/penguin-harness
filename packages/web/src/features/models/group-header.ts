/**
 * What a provider group's header offers on its right side, decided in one place so the models
 * page renders it and the tests pin it without a DOM.
 *
 * The actions stand in a fixed order: the balance (where the catalog declares one), Connect
 * with its status (groups whose key comes from an authorization flow), Sync (a connected
 * Penguin Go), Enter key, the speed test, Add model (groups that take hand-added models),
 * Delete group (user-defined groups). A member sees what they can read — the balance and the
 * connection status, without its button; every action that writes is the owner's.
 */
import {
  MODEL_PROVIDERS,
  PENGUIN_GO_PROVIDER_ID,
  isAddableGroup,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";

export type GroupHeaderAction =
  "balance" | "connect" | "platformSync" | "groupKey" | "speedTest" | "addModel" | "deleteGroup";

/** A row as far as the connection is concerned: whether it holds a stored (masked) key. */
export interface KeyedRowLike {
  credential?: { apiKeyMasked?: string } | undefined;
}

/** The group obtains its key through an authorization flow: TokenDance's own, or a bridged one. */
export function hasConnectFlow(provider: ModelProviderInfo): boolean {
  return provider.oauth !== undefined || provider.bridgeAuth !== undefined;
}

/**
 * Whether the group holds a stored key on any row — what "connected" means, however the key
 * got there (a connect flow, Enter key, or a key typed on one model).
 */
export function groupKeyStored(rows: readonly KeyedRowLike[]): boolean {
  return rows.some((row) => Boolean(row.credential?.apiKeyMasked));
}

/** The status beside Connect, or null for a group that has no connect flow. */
export function connectionStatus(
  provider: ModelProviderInfo,
  rows: readonly KeyedRowLike[],
): "connected" | "notConnected" | null {
  if (!hasConnectFlow(provider)) return null;
  return groupKeyStored(rows) ? "connected" : "notConnected";
}

export interface GroupHeaderFacts {
  isOwner: boolean;
  /** The group holds a stored key (groupKeyStored). */
  keyStored: boolean;
  /**
   * This group's balance is the one pinned beside the user name. It keeps the balance in the
   * header even after the key is gone, so the pin can still be taken off where it was put on.
   */
  balancePinned: boolean;
}

/** The header's actions, in the order they stand. */
export function groupHeaderActions(
  provider: ModelProviderInfo,
  { isOwner, keyStored, balancePinned }: GroupHeaderFacts,
): GroupHeaderAction[] {
  const actions: GroupHeaderAction[] = [];
  // Without a stored key there is nothing to ask the vendor with, so no balance is shown.
  if (provider.balance !== undefined && (keyStored || balancePinned)) actions.push("balance");
  if (hasConnectFlow(provider)) actions.push("connect");
  if (!isOwner) return actions;
  if (provider.id === PENGUIN_GO_PROVIDER_ID && keyStored) actions.push("platformSync");
  // Custom's rows each reach their own endpoint, so one key written across them is never right.
  if (provider.id !== "custom") actions.push("groupKey");
  actions.push("speedTest");
  if (isAddableGroup(provider.id)) actions.push("addModel");
  // A built-in group is catalog identity; a user-defined one exists only through its rows.
  if (!MODEL_PROVIDERS.some((p) => p.id === provider.id)) actions.push("deleteGroup");
  return actions;
}
