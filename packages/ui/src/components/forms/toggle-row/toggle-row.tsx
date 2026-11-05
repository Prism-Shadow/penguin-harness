/**
 * A label (with its "?") and hint beside a Switch: the one shape of an on/off setting.
 *
 * One row in three frames:
 *
 * - `row` (the default) is a preference row ({@link PrefRow}) in a ruled list — the settings
 *   pages, where rows separate with rules;
 * - `plain` sits in a stack whose parent spaces its children (a settings section's body, a plugin's
 *   fields) and draws nothing of its own;
 * - `card` stands alone at the head of a panel, in a hairline box (a feature's master switch).
 *
 * The switch is named by the row's label, since the title is a `<p>` beside it rather than a
 * `<label>` around it (a label would name the "?" button instead).
 */
import type { ReactNode } from "react";
import { PrefRow, PrefRowLabel } from "../pref-row/pref-row";
import { Switch } from "../switch/switch";

export type ToggleRowVariant = "row" | "plain" | "card";

const FRAME: Record<Exclude<ToggleRowVariant, "row">, string> = {
  plain: "flex items-center justify-between gap-3",
  card: "flex items-center justify-between gap-4 rounded-lg border border-line px-4 py-3",
};

export function ToggleRow({
  label,
  hint,
  info,
  checked,
  onChange,
  disabled,
  variant = "row",
}: {
  label: string;
  /** A line that stays on screen under the label: a state or a format, not what the row means. */
  hint?: string;
  /** Semantic explanation, disclosed by a "?" beside the label. */
  info?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  variant?: ToggleRowVariant;
}) {
  const control = (
    <Switch checked={checked} onChange={onChange} disabled={disabled} aria-label={label} />
  );
  if (variant === "row") {
    return (
      <PrefRow label={label} hint={hint} info={info}>
        {control}
      </PrefRow>
    );
  }
  return (
    <div className={FRAME[variant]}>
      <PrefRowLabel label={label} hint={hint} info={info} />
      <div className="shrink-0">{control}</div>
    </div>
  );
}
