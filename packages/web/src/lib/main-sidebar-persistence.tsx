import type { DragEvent as ReactDragEvent } from "react";
import { ICONS } from "@prismshadow/penguin-ui";
import type { NavEntryKey, NavEntryKey as NavGroupKey } from "./sidebar-nav-state";

export const SESSION_DRAG_MIME = "application/x-penguin-session-id";

export const GROUP_DRAG_MIME = "application/x-penguin-group-key";

export const isGroupDrag = (e: ReactDragEvent): boolean =>
  e.dataTransfer.types.includes(GROUP_DRAG_MIME);

export const NAV_DRAG_MIME = "application/x-penguin-nav-entry";

export const isNavDrag = (e: ReactDragEvent): boolean =>
  e.dataTransfer.types.includes(NAV_DRAG_MIME);

export type NavArea = "pinned" | "collapsible";

export const isNavPage = (key: NavEntryKey): key is NavGroupKey => key !== "newChat";

export const DRAG_POINTER_QUERY = "(hover: hover) and (pointer: fine)";

export const GROUP_ACTION_CLASS =
  "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors duration-150 hover:bg-fg/7 hover:text-fg";

export const collapsedGroupsKey = (projectId: string) =>
  `penguin.sidebarCollapsedGroups.${projectId}`;

export const pinnedGroupsKey = (projectId: string) => `penguin.sidebarPinnedGroups.${projectId}`;

export function loadGroupSet(storageKey: string | null): ReadonlySet<string> {
  if (!storageKey) return new Set();
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function saveGroupSet(storageKey: string | null, next: ReadonlySet<string>): void {
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify([...next]));
  } catch {
    /* best-effort persistence (quota/private mode) */
  }
}

export const DRAFTS_GROUP_KEY = "\0drafts";

export const NO_SCHEDULED_SESSIONS: ReadonlySet<string> = new Set();

export const NEW_CHAT_ICON = ICONS.penLine;
