/**
 * The behavior map's remembered width and visibility as one live value per page, so a layout
 * applied from the workspace header reaches an open player at once, and a player opened later
 * starts from it. Storage is read and written through `map-split.ts`; if it is blocked, the
 * value still holds for this page until it reloads (as `run-log-prefs.ts` does for reasoning).
 */
import { useSyncExternalStore } from "react";
import {
  MAP_VISIBLE_KEY,
  MAP_WIDTH_KEY,
  clampMapWidth,
  readMapVisible,
  readMapWidth,
  writeMapVisible,
  writeMapWidth,
} from "./map-split";

let visibleValue: boolean | null = null;
let widthValue: number | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== MAP_VISIBLE_KEY && event.key !== MAP_WIDTH_KEY) return;
    visibleValue = null;
    widthValue = null;
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function currentMapVisible(): boolean {
  return visibleValue ?? readMapVisible();
}

export function currentMapWidth(): number {
  return widthValue ?? readMapWidth();
}

/** Shows or hides the map everywhere on the page, and remembers it. */
export function setMapVisible(visible: boolean): void {
  visibleValue = visible;
  writeMapVisible(visible);
  notify();
}

/** Sets the remembered map width everywhere on the page. */
export function setMapWidth(width: number): void {
  widthValue = clampMapWidth(width);
  writeMapWidth(widthValue);
  notify();
}

export function useMapVisible(): boolean {
  return useSyncExternalStore(subscribe, currentMapVisible, () => true);
}

export function useMapWidth(): number {
  return useSyncExternalStore(subscribe, currentMapWidth, () => readMapWidth());
}
