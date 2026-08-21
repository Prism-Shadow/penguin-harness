/**
 * Row primitives for the System settings dialog's pages: a labelled preference row —
 * title on the left, the control on the right — meant to be stacked inside a `divide-y`
 * container so rows separate with rules rather than boxes. AccentPicker lives here too:
 * the accent swatches moved out of the sidebar user menu together with the rows that used
 * them.
 */
import type { ReactNode } from "react";
import { S } from "../../lib/strings";
import { ICON_GAP } from "../../lib/icon-scale";
import { InfoPopover } from "../../components/ui/info-popover";
import { ACCENT_SWATCHES } from "../../state/theme";
import type { Accent } from "../../state/theme";

export function PrefRow({
  label,
  hint,
  info,
  children,
}: {
  label: string;
  /**
   * A line that stays on screen. For what the value must look like, and for a fact about the
   * current state (the running build's date) — never for what the row means, which goes in
   * `info` so a reader who already knows is not made to scroll past it again.
   */
  hint?: string;
  /** Semantic explanation, disclosed by a "?" beside the label. */
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className={`flex items-center ${ICON_GAP.tight} text-sm font-medium`}>
          {label}
          {info !== undefined && <InfoPopover label={label}>{info}</InfoPopover>}
        </p>
        {hint !== undefined && (
          <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">{hint}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Accent color picker: a row of swatches, with a ring on the selected one. */
export function AccentPicker({
  value,
  onChange,
}: {
  value: Accent;
  onChange: (a: Accent) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {ACCENT_SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          title={S.settings.accentNames[s.value]}
          aria-label={S.settings.accentNames[s.value]}
          aria-pressed={value === s.value}
          onClick={() => onChange(s.value)}
          className={`h-5 w-5 rounded-full border transition-transform duration-150 hover:scale-110 ${
            value === s.value
              ? "border-gray-500 ring-2 ring-gray-400/50 dark:border-gray-300"
              : "border-transparent"
          }`}
          style={{ backgroundColor: s.color }}
        />
      ))}
    </div>
  );
}
