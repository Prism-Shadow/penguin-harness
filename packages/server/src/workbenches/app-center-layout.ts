/**
 * One viewer's arrangement of a Project's App Center: the grid in order, each item an app by its
 * `<agentId>/<workbenchId>` key or a folder of apps. It is theirs alone, so it lives in their
 * ui_prefs (`appCenterLayouts`, by Project id) and is written only through
 * PUT /api/projects/:projectId/app-center/layout.
 *
 * The keys are not compared with the shortcuts there are: the list changes with every Agent's
 * files, and the Web App drops what it is not shown. The bounds keep one account's row small;
 * a layout that breaks one is refused whole, and one stored that no longer holds up reads as none.
 */
import type { AppCenterLayout, AppCenterLayoutItem, UiPrefs } from "../api/types.js";
import { badRequest } from "../http/errors.js";
import type { UiPrefsStore } from "../mechanisms/settings.js";

const MAX_ITEMS = 500;
const MAX_FOLDER_APPS = 500;
const MAX_APPS = 1000;
const APP_KEY_MAX = 200;
const FOLDER_ID = /^[A-Za-z0-9_-]{1,32}$/;
const FOLDER_NAME_MAX = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** `<agentId>/<workbenchId>`: one `/`, both sides non-empty, at most 200 characters. */
function isAppKey(value: unknown): value is string {
  if (typeof value !== "string" || value.length > APP_KEY_MAX) return false;
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => part !== "");
}

const APP_KEY_RULE = `an app key "<agentId>/<workbenchId>" of at most ${APP_KEY_MAX} characters`;

/** The item as stored, or the rule it breaks. */
function checkItem(value: unknown, at: string): AppCenterLayoutItem | string {
  if (isRecord(value) && value["type"] === "app") {
    const app = value["app"];
    return isAppKey(app) ? { type: "app", app } : `${at}.app must be ${APP_KEY_RULE}.`;
  }
  if (!isRecord(value) || value["type"] !== "folder") {
    return `${at} must be { "type": "app", "app" } or { "type": "folder", "id", "name", "apps" }.`;
  }
  const { id, name, apps } = value;
  if (typeof id !== "string" || !FOLDER_ID.test(id)) {
    return `${at}.id must be 1 to 32 letters, digits, "_" or "-".`;
  }
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "" || Array.from(trimmed).length > FOLDER_NAME_MAX) {
    return `${at}.name must be a string of 1 to ${FOLDER_NAME_MAX} characters once trimmed.`;
  }
  if (!Array.isArray(apps) || apps.length === 0 || apps.length > MAX_FOLDER_APPS) {
    return `${at}.apps must hold 1 to ${MAX_FOLDER_APPS} app keys.`;
  }
  const bad = apps.findIndex((app) => !isAppKey(app));
  if (bad >= 0) return `${at}.apps[${bad}] must be ${APP_KEY_RULE}.`;
  return { type: "folder", id, name: trimmed, apps: apps as string[] };
}

/** The layout as stored (only its known fields, folder names trimmed), or the rule it breaks. */
function checkLayout(value: unknown): AppCenterLayout | string {
  if (!isRecord(value)) return "layout must be { v: 1, items: [...] }, or null.";
  if (value["v"] !== 1) return "layout.v must be 1.";
  const items = value["items"];
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    return `layout.items must be a list of at most ${MAX_ITEMS} items.`;
  }
  const out: AppCenterLayoutItem[] = [];
  const apps = new Set<string>();
  const folders = new Set<string>();
  let count = 0;
  for (const [i, raw] of items.entries()) {
    const item = checkItem(raw, `layout.items[${i}]`);
    if (typeof item === "string") return item;
    if (item.type === "folder") {
      if (folders.has(item.id)) return `layout has two folders with the id "${item.id}".`;
      folders.add(item.id);
    }
    for (const app of item.type === "app" ? [item.app] : item.apps) {
      if (apps.has(app)) return `layout names the app "${app}" twice; an app appears once.`;
      apps.add(app);
    }
    count += item.type === "app" ? 1 : item.apps.length;
    if (count > MAX_APPS) return `layout must hold at most ${MAX_APPS} app keys in all.`;
    out.push(item);
  }
  return { v: 1, items: out };
}

/** A layout sent to be stored, as it will be stored; a 400 naming the rule it breaks. */
export function parseAppCenterLayout(value: unknown): AppCenterLayout {
  const checked = checkLayout(value);
  if (typeof checked === "string") throw badRequest(checked);
  return checked;
}

/** The prefs document; one that does not parse reads as empty, as GET /api/me/prefs reads it. */
function readPrefs(store: UiPrefsStore, userId: string): UiPrefs {
  try {
    const parsed: unknown = JSON.parse(store.get(userId) ?? "{}");
    return isRecord(parsed) ? (parsed as UiPrefs) : {};
  } catch {
    return {};
  }
}

/** The viewer's arrangement of the Project's App Center; null when they have none that holds up. */
export function readAppCenterLayout(
  store: UiPrefsStore,
  userId: string,
  projectId: string,
): AppCenterLayout | null {
  const layouts = readPrefs(store, userId).appCenterLayouts;
  if (!isRecord(layouts) || !Object.hasOwn(layouts, projectId)) return null;
  const checked = checkLayout(layouts[projectId]);
  return typeof checked === "string" ? null : checked;
}

/**
 * Replaces the viewer's arrangement of one Project (null removes it), and lets go of the ones
 * kept for Projects that no longer exist. Read and written with nothing awaited between, so a
 * concurrent prefs write is not lost to this one.
 */
export function writeAppCenterLayout(
  store: UiPrefsStore,
  userId: string,
  projectId: string,
  layout: AppCenterLayout | null,
  projectExists: (projectId: string) => boolean,
): void {
  const { appCenterLayouts: stored, ...prefs } = readPrefs(store, userId);
  const kept: Record<string, AppCenterLayout> = {};
  for (const [id, value] of Object.entries(isRecord(stored) ? stored : {})) {
    if (id !== projectId && projectExists(id)) kept[id] = value as AppCenterLayout;
  }
  if (layout !== null) kept[projectId] = layout;
  const next: UiPrefs = { ...prefs };
  if (Object.keys(kept).length > 0) next.appCenterLayouts = kept;
  store.set(userId, JSON.stringify(next));
}
