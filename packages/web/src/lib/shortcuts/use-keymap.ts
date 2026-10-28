/**
 * React reads of the keymap. Every display site of a chord goes through these, so a change made
 * in the settings dialog — or in another tab, through the mirror's `storage` event — redraws the
 * tooltip, the kbd and the button title without a reload. A command holds a list of bindings; a
 * display read shows the FIRST chord this host can deliver (⌘W in a browser tab closes the tab,
 * whatever it is bound to, so no tooltip promises a key that does the opposite); the settings
 * page reads the whole list and says why.
 */
import { useSyncExternalStore } from "react";
import { formatChord } from "./format";
import { currentHost, currentPlatform } from "./platform";
import { shownOnHost } from "./reserved";
import { bindingsOf, keyboardLayout, keymap, keymapVersion, subscribeKeymap } from "./store";
import type { Chord, CommandId, Keymap } from "./types";

export function useKeymap(): Keymap {
  useSyncExternalStore(subscribeKeymap, keymapVersion, keymapVersion);
  return keymap();
}

/** The command's chord for display: the first binding this host delivers, or null while unbound. */
export function useDisplayedBinding(id: CommandId): Chord | null {
  useKeymap();
  return displayedBinding(id);
}

/**
 * useDisplayedBinding's read without the subscription, for a surface that shows the chords of
 * commands it learns at render (the dock picker's panel rows): call it under one `useKeymap()`.
 */
export function displayedBinding(id: CommandId): Chord | null {
  const platform = currentPlatform();
  const host = currentHost();
  for (const chord of bindingsOf(id)) {
    if (shownOnHost(chord, platform, host)) return chord;
  }
  return null;
}

/** The displayed chord as the platform writes it, or null when there is nothing to show. */
export function useShortcutLabel(id: CommandId): string | null {
  const chord = useDisplayedBinding(id);
  return chord === null
    ? null
    : formatChord(chord, currentPlatform(), keyboardLayout() ?? undefined);
}

/** A control's tooltip naming the command's chord after its label — "Search sessions (⌥⌘S)" — or the label alone. */
export function useShortcutTitle(label: string, id: CommandId): string {
  const chord = useShortcutLabel(id);
  return chord === null ? label : `${label} (${chord})`;
}
