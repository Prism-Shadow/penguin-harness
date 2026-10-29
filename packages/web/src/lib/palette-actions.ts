/**
 * How a mounted page adds actions to the one command palette. The palette mounts beside the
 * shell's tree (src/rescue/palette.tsx) and imports no feature, so a page that has a command of
 * its own registers it here for as long as it is mounted — the full-page workflow route offers
 * its way out this way. Registered actions are listed ahead of the palette's standing ones,
 * the newest registration first.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { PaletteAction } from "@prismshadow/penguin-ui";

/** One entry per registration, so the same list registered twice unregisters independently. */
let registrations: Array<{ actions: readonly PaletteAction[] }> = [];
let snapshot: readonly PaletteAction[] = [];
const listeners = new Set<() => void>();

function publish(): void {
  snapshot = registrations.flatMap((r) => r.actions);
  listeners.forEach((l) => l());
}

/** Adds the actions until the returned function is called. */
export function addPaletteActions(actions: readonly PaletteAction[]): () => void {
  const entry = { actions };
  registrations = [entry, ...registrations];
  publish();
  return () => {
    if (!registrations.includes(entry)) return;
    registrations = registrations.filter((r) => r !== entry);
    publish();
  };
}

/** Every registered action, newest registration first. */
export function addedPaletteActions(): readonly PaletteAction[] {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Registers the actions while the calling component is mounted; keep the array stable (memoize it). */
export function usePaletteActions(actions: readonly PaletteAction[]): void {
  useEffect(() => addPaletteActions(actions), [actions]);
}

/** The palette's read of the registered actions. */
export function useAddedPaletteActions(): readonly PaletteAction[] {
  return useSyncExternalStore(subscribe, addedPaletteActions, addedPaletteActions);
}
