/**
 * A keyboard chord drawn the way the platform writes it: one glyph run on macOS (`⌘W`), one key
 * per token joined by `+` elsewhere (`Ctrl+W`). The platform and the keyboard layout are the
 * app's to know, so this formats the chord and the shared `Kbd` draws it, in its plain look; the
 * caller supplies the colour.
 */
import { Kbd } from "@prismshadow/penguin-ui";
import { formatChord } from "../../lib/shortcuts/format";
import { currentPlatform } from "../../lib/shortcuts/platform";
import { keyboardLayout } from "../../lib/shortcuts/store";
import type { Chord } from "../../lib/shortcuts/types";

/** The chord's keys as `Kbd` takes them: one glyph run on macOS, one key per `+` token elsewhere. */
export function chordKeys(chord: Chord): string[] {
  const platform = currentPlatform();
  const label = formatChord(chord, platform, keyboardLayout() ?? undefined);
  return platform === "mac" ? [label] : label.split("+");
}

export function ChordKbd({ chord, className = "" }: { chord: Chord; className?: string }) {
  return <Kbd keys={chordKeys(chord)} variant="plain" className={className} />;
}
