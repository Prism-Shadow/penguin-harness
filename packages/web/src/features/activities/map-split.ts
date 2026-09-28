/**
 * The player and its behavior map side by side: how wide the map is, whether it is shown,
 * when there is room for both beside each other, and which of the current state's tap
 * targets the map lists. Kept pure, with storage passed in, so it is testable without a DOM.
 */
import type { PlayerInteractable } from "./player-bridge";

export const MAP_WIDTH_KEY = "penguin.activityMapWidth";
export const MAP_VISIBLE_KEY = "penguin.activityMapVisible";

/** The map's width bounds, in pixels. */
export const MAP_MIN = 260;
export const MAP_MAX = 880;
export const MAP_DEFAULT = 360;
/** How far one arrow key moves the divider. */
export const MAP_STEP = 20;
/** The player never gets narrower than this beside the map. */
export const PLAYER_MIN = 320;
/** The divider and the space on either side of it. */
export const MAP_GUTTER = 24;
/** The narrowest panel that holds the player and the map beside each other. */
export const SIDE_BY_SIDE_MIN = 960;

/** Whether the map can sit beside the player rather than under it. */
export function sideBySide(containerWidth: number): boolean {
  return Number.isFinite(containerWidth) && containerWidth >= SIDE_BY_SIDE_MIN;
}

/** The widest the map may be in a container, leaving the player its minimum. */
export function mapMaxFor(container?: number): number {
  if (container === undefined || !Number.isFinite(container) || container <= 0) return MAP_MAX;
  return Math.max(MAP_MIN, Math.min(MAP_MAX, Math.floor(container - PLAYER_MIN - MAP_GUTTER)));
}

/** A width within the bounds, and one that leaves the player room when the container is known. */
export function clampMapWidth(width: number, container?: number): number {
  if (!Number.isFinite(width)) return Math.min(MAP_DEFAULT, mapMaxFor(container));
  return Math.min(mapMaxFor(container), Math.max(MAP_MIN, Math.round(width)));
}

export type MapKey = "ArrowLeft" | "ArrowRight" | "Home" | "End";

/**
 * The width after a key on the divider, or null for a key it does not handle. The map sits
 * to the right of the divider, so moving the divider left widens it.
 */
export function stepMapWidth(width: number, key: string, container?: number): number | null {
  if (key === "ArrowLeft") return clampMapWidth(width + MAP_STEP, container);
  if (key === "ArrowRight") return clampMapWidth(width - MAP_STEP, container);
  if (key === "Home") return MAP_MIN;
  if (key === "End") return mapMaxFor(container);
  return null;
}

/** The remembered width; unreadable storage gives the default. */
export function readMapWidth(storage?: Pick<Storage, "getItem">): number {
  try {
    const raw = (storage ?? localStorage).getItem(MAP_WIDTH_KEY);
    return raw ? clampMapWidth(Number(raw)) : MAP_DEFAULT;
  } catch {
    return MAP_DEFAULT;
  }
}

export function writeMapWidth(width: number, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(MAP_WIDTH_KEY, String(clampMapWidth(width)));
  } catch {
    // Storage may be unavailable; the width then lasts as long as the page.
  }
}

/** Only an explicit "hidden" hides, so unreadable storage shows the map. */
export function readMapVisible(storage?: Pick<Storage, "getItem">): boolean {
  try {
    return (storage ?? localStorage).getItem(MAP_VISIBLE_KEY) !== "hidden";
  } catch {
    return true;
  }
}

export function writeMapVisible(visible: boolean, storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? localStorage).setItem(MAP_VISIBLE_KEY, visible ? "shown" : "hidden");
  } catch {
    // As above.
  }
}

/** The first few tap targets the map lists on the current state, and how many it leaves out. */
export function liveTargets(
  interactables: readonly PlayerInteractable[],
  limit = 3,
): { shown: PlayerInteractable[]; more: number } {
  const count = Math.max(0, Math.floor(limit));
  return {
    shown: interactables.slice(0, count),
    more: Math.max(0, interactables.length - count),
  };
}
