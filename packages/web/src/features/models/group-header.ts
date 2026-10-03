/**
 * What a provider group's header offers on its right side, decided in one place so the models
 * page renders it and the tests pin it without a DOM.
 *
 * The actions stand in a fixed order: the balance (where the catalog declares one), then a
 * divider, the connection (groups whose key comes from an authorization flow: "Not connected",
 * which connects when pressed, or one "Connected" menu holding Sync models, Reconnect and
 * Disconnect), Add model (groups that take hand-added models; an icon), Delete group
 * (user-defined groups), the speed test, and the group settings last — every group ends on the
 * speed test and the gear, so the pair stands at the same right edge down the page. The group
 * key is set in the settings (or by Connect); the header has no field of its own for it. A
 * member sees what they can read — the balance with its menu, and the connection status as
 * plain text; every action that writes is the owner's.
 */
import {
  MODEL_PROVIDERS,
  PENGUIN_GO_PROVIDER_ID,
  isAddableGroup,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelProviderInfo } from "@prismshadow/penguin-core/model-catalog";
import type { ProviderConnectionDto } from "@prismshadow/penguin-server/api";

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
  "balance" | "connect" | "addModel" | "deleteGroup" | "speedTest" | "settings";

/** What the "Connected" menu holds, in order. */
export type ConnectedMenuItem = "syncModels" | "reconnect" | "disconnect";

/** A row as far as the environment is concerned (GET /models' preview). */
export interface EnvKeyedRowLike {
  /**
   * The masked environment key the row falls back to: reported only when neither the row nor
   * its group holds a key and the environment lends one on the row's effective endpoint.
   */
  envKeyMasked?: string | undefined;
}

/** The group obtains its key through an authorization flow: TokenDance's own, or a bridged one. */
export function hasConnectFlow(provider: ModelProviderInfo): boolean {
  return provider.oauth !== undefined || provider.bridgeAuth !== undefined;
}

/**
 * Whether the group holds its own key (`[providers.<id>]`) — what "connected" means, however the
 * key got there (a connect flow or the group settings). A key typed on one model is
 * that model's alone and does not count: the group's other models cannot use it.
 */
export function groupKeyStored(group: ProviderConnectionDto | undefined): boolean {
  return Boolean(group?.apiKeyMasked);
}

/**
 * Whether a row's key comes from the server's environment — DeepSeek's DEEPSEEK_API_KEY, say,
 * which the credential rule lends only on the vendor's own endpoint. It does not make a group
 * "connected"; it does let the balance be read.
 */
export function groupKeyFromEnv(rows: readonly EnvKeyedRowLike[]): boolean {
  return rows.some((row) => Boolean(row.envKeyMasked));
}

/** The group's connection status, or null for a group that has no connect flow. */
export function connectionStatus(
  provider: ModelProviderInfo,
  group: ProviderConnectionDto | undefined,
): "connected" | "notConnected" | null {
  if (!hasConnectFlow(provider)) return null;
  return groupKeyStored(group) ? "connected" : "notConnected";
}

export interface GroupHeaderFacts {
  isOwner: boolean;
  /** The group holds its own key (groupKeyStored). */
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
  if (isAddableGroup(provider.id)) actions.push("addModel");
  // A built-in group is catalog identity; a user-defined one exists only through its rows.
  if (!MODEL_PROVIDERS.some((p) => p.id === provider.id)) actions.push("deleteGroup");
  // The last two on every group, custom included, so the speed test and the gear line up down
  // the page's right edge.
  actions.push("speedTest", "settings");
  return actions;
}

/**
 * The rows of a connected group's menu: Sync models on Penguin Go, whose platform catalog the
 * group key reads; then Reconnect (the group's flow again, for a fresh key or another account)
 * and Disconnect (clears the group key), on every group with a connect flow.
 */
export function connectedMenuItems(provider: ModelProviderInfo): ConnectedMenuItem[] {
  return provider.id === PENGUIN_GO_PROVIDER_ID
    ? ["syncModels", "reconnect", "disconnect"]
    : ["reconnect", "disconnect"];
}
