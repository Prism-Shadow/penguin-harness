/**
 * React reads of the keymap. Every display site of a chord goes through these, so a change made
 * in the settings dialog — or in another tab, through the mirror's `storage` event — redraws the
 * tooltip, the kbd and the button title without a reload. A display read also drops a chord the
 * host cannot deliver (⌘W in a browser tab closes the tab, not the terminal), so no tooltip
 * promises a key that does the opposite; the settings page reads the raw keymap and says why.
 */
import { useSyncExternalStore } from "react";
import { formatChord } from "./format";
import { currentHost, currentPlatform } from "./platform";
import { shownOnHost } from "./reserved";
import { bindingOf, keyboardLayout, keymap, keymapVersion, subscribeKeymap } from "./store";
import type { Chord, CommandId, Keymap } from "./types";

export function useKeymap(): Keymap {
  useSyncExternalStore(subscribeKeymap, keymapVersion, keymapVersion);
  return keymap();
}

/** The command's chord as bound, whether or not this host can deliver it. */
export function useBinding(id: CommandId): Chord | null {
  useKeymap();
  return bindingOf(id);
}

/** The command's chord for display: null while unbound, and null for a chord this host reserves. */
export function useDisplayedBinding(id: CommandId): Chord | null {
  const chord = useBinding(id);
  return chord !== null && shownOnHost(chord, currentPlatform(), currentHost()) ? chord : null;
}

/** The displayed chord as the platform writes it, or null when there is nothing to show. */
export function useShortcutLabel(id: CommandId): string | null {
  const chord = useDisplayedBinding(id);
  return chord === null
    ? null
    : formatChord(chord, currentPlatform(), keyboardLayout() ?? undefined);
}

/** A control's tooltip naming the command's chord after its label — "Search sessions (⌘K)" — or the label alone. */
export function useShortcutTitle(label: string, id: CommandId): string {
  const chord = useShortcutLabel(id);
  return chord === null ? label : `${label} (${chord})`;
}
