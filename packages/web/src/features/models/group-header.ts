/**
 * What a provider group's header offers on its right side, decided in one place so the models
 * page renders it and the tests pin it without a DOM.
 *
 * The actions stand in a fixed order: the balance (where the catalog declares one), then a
 * divider, Connect with its status (groups whose key comes from an authorization flow), Sync (a
 * connected Penguin Go), Enter key, the speed test, Add model (groups that take hand-added
 * models), Delete group (user-defined groups). A member sees what they can read — the balance
 * and the connection status, without its button; every action that writes is the owner's.
 */
import {
  MODEL_PROVIDERS,
  PENGUIN_GO_PROVIDER_ID,
  isAddableGroup,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";

/**
 * One box for everything on the header's right side, so its items share one height, one inset
 * and one centre line: Button's `icon` size insets its glyph by 1.5 on every side, the plain
 * items (the balance, the connection status) take the same inset, and the header's single gap-2
 * spaces them all. A label rides inside its button at its neighbours' text rung and gives way
 * on a narrow header.
 */
export const HEADER_BUTTON = "h-7 shrink-0";
export const HEADER_SQUARE = "h-7 w-7 shrink-0";
export const HEADER_TEXT = "flex h-7 shrink-0 items-center px-1.5 text-xs";
export const HEADER_LABEL = "hidden text-xs @3xl:inline";

export type GroupHeaderAction =
  "balance" | "connect" | "platformSync" | "groupKey" | "speedTest" | "addModel" | "deleteGroup";

/** A row as far as its key is concerned: a stored (masked) key, or one lent by the server's environment. */
export interface KeyedRowLike {
  credential?: { apiKeyMasked?: string } | undefined;
  /** The masked environment key the row falls back to (GET /models' preview); absent when none applies. */
  envKeyMasked?: string | undefined;
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

/**
 * Whether a row's key comes from the server's environment — DeepSeek's DEEPSEEK_API_KEY, say,
 * which the credential rule lends only on the vendor's own endpoint. It does not make a group
 * "connected"; it does let the balance be read.
 */
export function groupKeyFromEnv(rows: readonly KeyedRowLike[]): boolean {
  return rows.some((row) => Boolean(row.envKeyMasked));
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
  /** A row's key comes from the server's environment instead (groupKeyFromEnv). */
  keyFromEnv?: boolean;
  /**
   * This group's balance is the one pinned beside the user name. It keeps the balance in the
   * header even after the key is gone, so the pin can still be taken off where it was put on.
   */
  balancePinned: boolean;
}

/** The header's actions, in the order they stand. */
export function groupHeaderActions(
  provider: ModelProviderInfo,
  { isOwner, keyStored, keyFromEnv = false, balancePinned }: GroupHeaderFacts,
): GroupHeaderAction[] {
  const actions: GroupHeaderAction[] = [];
  // Without a key, stored or from the environment, there is nothing to ask the vendor with.
  if (provider.balance !== undefined && (keyStored || keyFromEnv || balancePinned)) {
    actions.push("balance");
  }
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

/**
 * Whether a divider follows the balance: it separates the account's figure from the group's
 * status and actions, so it stands only where the balance leads and something comes after it.
 */
export function dividerAfterBalance(actions: readonly GroupHeaderAction[]): boolean {
  return actions[0] === "balance" && actions.length > 1;
}
