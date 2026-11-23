/**
 * Dense one-line rows for a detail section: what a package ships, what sits on an Agent. Each row
 * is a lead glyph in the subtle ink, the thing's name, quiet facts after it — a transport, a
 * version, a target — and the row's marks and controls at its end.
 *
 * One line, whatever the lengths: the glyph, the name and every fact but the last keep their
 * width; the last fact takes what is left and truncates (whole on hover, through the app's
 * tooltip layer, which reads the cut-off line's own text); the marks at the end keep their width
 * and sit at the row's end even when there are no facts. A muted row names something absent — a
 * part the Agent lacks — and is in muted ink throughout; its trailing mark says why.
 *
 * `FactList` is the rows' list, 6px apart, with an optional accessible name.
 *
 * Props only: every word is the caller's.
 */
import type { ReactNode } from "react";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

/** The rows of a detail section, as a list. */
export function FactList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul className="space-y-1.5" {...(label !== undefined ? { "aria-label": label } : {})}>
      {children}
    </ul>
  );
}

export interface FactRowProps {
  /** A registry path from `ICONS`, drawn subtle before the name. */
  glyph?: string;
  name: ReactNode;
  /** The name is an identifier: set it in the mono face. */
  mono?: boolean;
  /** Quiet facts after the name; the last one takes the remaining width and truncates. */
  children?: ReactNode;
  /** Marks and controls at the row's end; they keep their width. */
  trailing?: ReactNode;
  /** The row names something absent: muted ink throughout. */
  muted?: boolean;
}

export function FactRow({
  glyph,
  name,
  mono = false,
  children,
  trailing,
  muted = false,
}: FactRowProps) {
  return (
    <li className={`flex min-w-0 items-center ${ICON_GAP.menu} text-xs`}>
      {glyph !== undefined && (
        <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} className="shrink-0 text-fg-subtle" />
      )}
      <span
        className={`shrink-0 ${mono ? "font-mono" : ""} ${muted ? "text-fg-muted" : "text-fg"}`}
      >
        {name}
      </span>
      {children !== undefined && children !== null && children !== false && (
        // The facts are this box's own children, so the last one is found by position: it alone
        // may shrink, and truncates when it does.
        <span
          className={`flex min-w-0 flex-1 items-center ${ICON_GAP.menu} ${muted ? "text-fg-subtle" : "text-fg-muted"} [&>*]:shrink-0 [&>*:last-child]:min-w-0 [&>*:last-child]:shrink [&>*:last-child]:truncate`}
        >
          {children}
        </span>
      )}
      {trailing !== undefined && trailing !== null && trailing !== false && (
        <span className={`ml-auto flex shrink-0 items-center ${ICON_GAP.row}`}>{trailing}</span>
      )}
    </li>
  );
}
