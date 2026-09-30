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

/** `picker`: the dock picker's small kbd beside a row label; `control`: inside a settings control, at the form rung. */
const sizeClass = {
  picker: "font-mono text-[10px]",
  control: "font-mono text-xs",
};

export function Kbd({
  chord,
  size: rung = "picker",
  className = "",
}: {
  chord: Chord;
  size?: keyof typeof sizeClass;
  className?: string;
}) {
  const platform = currentPlatform();
  const label = formatChord(chord, platform, keyboardLayout() ?? undefined);
  const size = sizeClass[rung];
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
