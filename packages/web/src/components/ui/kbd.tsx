/**
 * A keyboard chord drawn the way the platform writes it: one glyph run on macOS (`⌘W`), one
 * `<kbd>` per token joined by `+` elsewhere (`Ctrl+W`). The size is the picker's existing kbd
 * size; the caller supplies the colour.
 */
import { Fragment } from "react";
import { formatChord } from "../../lib/shortcuts/format";
import { currentPlatform } from "../../lib/shortcuts/platform";
import { keyboardLayout } from "../../lib/shortcuts/store";
import type { Chord } from "../../lib/shortcuts/types";

export function Kbd({ chord, className = "" }: { chord: Chord; className?: string }) {
  const platform = currentPlatform();
  const label = formatChord(chord, platform, keyboardLayout() ?? undefined);
  const size = "font-mono text-[10px]";
  if (platform === "mac") return <kbd className={`${size} ${className}`}>{label}</kbd>;
  const tokens = label.split("+");
  return (
    <span className={`inline-flex items-center ${size} ${className}`}>
      {tokens.map((token, i) => (
        <Fragment key={i}>
          {i > 0 && <span aria-hidden>+</span>}
          <kbd>{token}</kbd>
        </Fragment>
      ))}
    </span>
  );
}
