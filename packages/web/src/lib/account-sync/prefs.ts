/**
 * The preferences that follow the account: every one a person sets on the Settings pages, plus
 * the composer's mid-run send mode. Each has a field in the account's `ui_prefs` and a key in
 * this browser's cache (cache.ts), and this table is the one place that pairs them.
 *
 * What is NOT here stays in the browser by design: the layout of one screen (panel widths, the
 * dock's arrangement, the sidebar's collapse and folds, where the launcher rests), the Project
 * last opened, and the notices dismissed in this browser. Those describe a device, not a person.
 *
 * The cache holds each value as the string the app has always stored under its key; the account
 * holds the JSON value the string means. The table converts both ways and drops anything it
 * cannot convert, so a value garbled on either side reads as the preference's default rather
 * than travelling on.
 *
 * Pure — no React, no `window`, no requests — so the decision of what to write where is testable
 * against an in-memory store (sync.ts does the I/O).
 */
import type { UiPrefs } from "@prismshadow/penguin-server/api";
import { BACKGROUND_STORAGE_KEYS, THEME_STORAGE_KEYS } from "@prismshadow/penguin-ui/boot";
import { LAUNCHER_HIDDEN_KEY } from "../../features/dock/dock-launcher-state";
import { STEER_MODE_KEY } from "../../features/chat/steer-mode";
import { CURRENCY_KEY, TERMINAL_THEME_KEY, TOOL_ALIASES_KEY } from "../../state/theme-prefs";
import { LANG_KEY } from "../../state/locale-pref";
import { NOTIFICATIONS_KEY } from "../notification-pref";

/** The `ui_prefs` fields this table syncs. */
export type SyncedPrefField =
  | "themeMode"
  | "themeId"
  | "accent"
  | "textSize"
  | "fontLatin"
  | "fontCjk"
  | "lang"
  | "currency"
  | "terminalTheme"
  | "toolAliases"
  | "notifications"
  | "launcherHidden"
  | "steerMode"
  | "background";

export interface SyncedPref {
  field: SyncedPrefField;
  /** The localStorage key that caches it. */
  key: string;
  /** The cached string as the account stores it; undefined when it is not one this field takes. */
  toAccount(cached: string): unknown;
  /** The account's value as cached here; null when it is not one (the cache then drops the key). */
  toCache(value: unknown): string | null;
}

/** A short token, the shape the server accepts for these fields. */
const TOKEN = /^[A-Za-z0-9_-]{1,64}$/;

const token = (field: SyncedPrefField, key: string): SyncedPref => ({
  field,
  key,
  toAccount: (cached) => (TOKEN.test(cached) ? cached : undefined),
  toCache: (value) => (typeof value === "string" && TOKEN.test(value) ? value : null),
});

/** A switch cached as "1" / "0", which is how every switch here has always been stored. */
const flag = (field: SyncedPrefField, key: string): SyncedPref => ({
  field,
  key,
  toAccount: (cached) => (cached === "1" ? true : cached === "0" ? false : undefined),
  toCache: (value) => (value === true ? "1" : value === false ? "0" : null),
});

/** An object cached as its JSON text (the background's display settings). */
const object = (field: SyncedPrefField, key: string): SyncedPref => ({
  field,
  key,
  toAccount: (cached) => {
    try {
      const parsed: unknown = JSON.parse(cached);
      return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? parsed
        : undefined;
    } catch {
      return undefined;
    }
  },
  toCache: (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? JSON.stringify(value)
      : null,
});

export const SYNCED_PREFS: readonly SyncedPref[] = [
  token("themeMode", THEME_STORAGE_KEYS.mode),
  token("themeId", THEME_STORAGE_KEYS.themeId),
  token("accent", THEME_STORAGE_KEYS.accent),
  token("textSize", THEME_STORAGE_KEYS.textSize),
  token("fontLatin", THEME_STORAGE_KEYS.fontLatin),
  token("fontCjk", THEME_STORAGE_KEYS.fontCjk),
  token("lang", LANG_KEY),
  token("currency", CURRENCY_KEY),
  token("terminalTheme", TERMINAL_THEME_KEY),
  flag("toolAliases", TOOL_ALIASES_KEY),
  flag("notifications", NOTIFICATIONS_KEY),
  flag("launcherHidden", LAUNCHER_HIDDEN_KEY),
  token("steerMode", STEER_MODE_KEY),
  object("background", BACKGROUND_STORAGE_KEYS.settings),
];

/**
 * The background image is a preference too, but it is not a `ui_prefs` field: the account keeps
 * it on its own route and names it in `ui_prefs.backgroundImageId`. The pseudo-field stands for
 * it wherever a pending edit is tracked.
 */
export const BACKGROUND_IMAGE = "backgroundImage";
export const BACKGROUND_IMAGE_KEY = BACKGROUND_STORAGE_KEYS.image;
/** Which of the account's images the cached one is (a cache marker; never a user edit). */
export const BACKGROUND_IMAGE_ID_KEY = "penguin.background.imageId";

/** What a pending edit can name: a synced field, or the background image. */
export type PendingPref = SyncedPrefField | typeof BACKGROUND_IMAGE;

/** The pending name a cached key's edit is tracked under, or null when the key is not synced. */
export function pendingPrefOfKey(key: string): PendingPref | null {
  if (key === BACKGROUND_IMAGE_KEY) return BACKGROUND_IMAGE;
  return SYNCED_PREFS.find((pref) => pref.key === key)?.field ?? null;
}

/** What to do about the background image after reading the account's preferences. */
export type ImageStep = "keep" | "fetch" | "drop" | "upload";

export interface PrefsPlan {
  /** Cache writes, in order: key → value, null removes it. */
  cache: Array<[key: string, value: string | null]>;
  /** What goes up to the account: an import, or edits it has not acknowledged yet. */
  upload: PendingPref[];
  image: ImageStep;
}

/** Whether the account holds any of the synced preferences at all. */
export function accountHoldsPrefs(account: UiPrefs): boolean {
  if (typeof account.backgroundImageId === "string") return true;
  return SYNCED_PREFS.some(
    (pref) => account[pref.field] !== undefined && account[pref.field] !== null,
  );
}

/**
 * Reconciles this browser's cache with the account's preferences.
 *
 * - `importing` (this browser has never handed its preferences to an account on this server)
 *   and an account that holds none: the browser's values go up, once, and the cache stays —
 *   the one-time import of preferences kept in the browser before they followed the account.
 * - Otherwise the account wins, field by field: its value is cached, and a field it does not
 *   hold is dropped from the cache, which reads as the default.
 * - Either way, a field with an edit the account has not acknowledged (`pending`) keeps the
 *   cached value and goes up again: the edit is newer than anything the account answered with.
 */
export function planPrefs(
  account: UiPrefs,
  cache: Pick<Storage, "getItem">,
  options: { importing: boolean; pending: ReadonlySet<string> },
): PrefsPlan {
  const plan: PrefsPlan = { cache: [], upload: [], image: "keep" };
  const read = (key: string): string | null => {
    try {
      return cache.getItem(key);
    } catch {
      return null;
    }
  };
  const cachedImage = read(BACKGROUND_IMAGE_KEY);

  if (options.importing && !accountHoldsPrefs(account)) {
    for (const pref of SYNCED_PREFS) {
      const cached = read(pref.key);
      if (cached !== null && pref.toAccount(cached) !== undefined) plan.upload.push(pref.field);
    }
    if (cachedImage !== null) {
      plan.upload.push(BACKGROUND_IMAGE);
      plan.image = "upload";
    }
    return plan;
  }

  for (const pref of SYNCED_PREFS) {
    if (options.pending.has(pref.field)) {
      plan.upload.push(pref.field);
      continue;
    }
    const wanted = pref.toCache(account[pref.field]);
    if (wanted !== read(pref.key)) plan.cache.push([pref.key, wanted]);
  }

  if (options.pending.has(BACKGROUND_IMAGE)) {
    plan.upload.push(BACKGROUND_IMAGE);
    plan.image = "upload";
  } else if (typeof account.backgroundImageId === "string") {
    const sameImage =
      cachedImage !== null && read(BACKGROUND_IMAGE_ID_KEY) === account.backgroundImageId;
    plan.image = sameImage ? "keep" : "fetch";
  } else if (cachedImage !== null) {
    plan.image = "drop";
  }
  return plan;
}
