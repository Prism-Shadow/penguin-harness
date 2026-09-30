/**
 * A glyph with a value: one reading in a row of readings (a turn's input, output, speed, cost and
 * time). The glyph alone does not say which reading it is, so `label` names the chip — as its
 * tooltip and its accessible name. The value is in tabular figures, so a row of chips that
 * updates does not jitter.
 *
 * `compactValue`, when it differs, replaces the value below the `sm` breakpoint (fewer decimals,
 * so a row fits a phone); `wideOnly` drops the whole chip there (the least useful reading of a
 * crowded row).
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

export function StatChip({
  glyph,
  value,
  compactValue,
  label,
  wideOnly = false,
}: {
  /** A 24×24 line path. */
  glyph: string;
  /** The reading: text, or a live element (a clock that ticks while a run is open). */
  value: ReactNode;
  compactValue?: string;
  /** What the reading is: the chip's tooltip and accessible name. */
  label: string;
  /** Shown from the `sm` breakpoint up only. */
  wideOnly?: boolean;
}) {
  return (
    <span
      data-tooltip={label}
      aria-label={label}
      className={`${wideOnly ? "hidden sm:flex" : "flex"} items-center ${ICON_GAP.tight} tabular-nums`}
    >
      <GlyphIcon d={glyph} />
      {compactValue !== undefined && compactValue !== value ? (
        <>
          <span className="sm:hidden">{compactValue}</span>
          <span className="hidden sm:inline">{value}</span>
        </>
      ) : (
        value
      )}
    </span>
  );
}
