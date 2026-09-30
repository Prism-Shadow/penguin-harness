/**
 * One KPI as its own bordered tile: a small glyph beside the label, the value bold beneath it,
 * and a quiet line of detail under that. A tone inks the glyph and the value together, so the
 * reading and its mark say the same thing.
 *
 * The tile is plain elements — a KPI is a reading, not a control, and a whole-tile click would
 * swallow whatever sits inside it. Anything extra rides beside the value as children (a gauge
 * that pictures the number).
 */
import type { ReactNode } from "react";
import type { ToneName } from "../../../tokens";
import { ICON_GAP, ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

const INK: Readonly<Record<ToneName, string>> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

export function StatTile({
  icon,
  label,
  value,
  tone,
  detail,
  children,
}: {
  /** A 24×24 line path for the label's glyph. */
  icon?: string;
  label: string;
  value: ReactNode;
  /** A reading that is a judgement (over budget, alerts raised): inks the glyph and the value. */
  tone?: ToneName;
  /** One quiet line under the value: what the number is measured against. */
  detail?: ReactNode;
  /** A visual beside the value. */
  children?: ReactNode;
}) {
  const ink = tone !== undefined ? INK[tone] : "";
  return (
    <div className="rounded-md border border-line bg-surface p-3">
      <p className={`mb-1.5 flex items-center ${ICON_GAP.row} text-xs text-fg-muted`}>
        {icon !== undefined && <GlyphIcon d={icon} size={ICON_SIZE.inlineGlyph} className={ink} />}
        <span className="truncate">{label}</span>
      </p>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate text-lg font-semibold tabular-nums ${ink}`}>{value}</p>
          {detail !== undefined && (
            <p className="mt-0.5 text-xs leading-snug text-fg-muted">{detail}</p>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
