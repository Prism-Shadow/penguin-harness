/**
 * The settings page's row primitives: a labelled preference row — title on the left, the control
 * on the right — meant to be stacked inside a ruled (`divide-y`) container so rows separate with
 * rules rather than boxes; the plainer row of a settings list with a one-line description; and
 * the section frame with its ruled action row.
 *
 * A row titles a control it does not own, so its title is a `<p>`, never a `<label>`: a label
 * would name its first labelable descendant, which beside a "?" is the disclosure button rather
 * than the control. A switch row with that shape is `ToggleRow`.
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { InfoPopover } from "../../overlays/info-popover/info-popover";

/**
 * The label slot a preference row and a toggle row share: the title with its "?" beside it, and
 * the hint under it.
 */
export function PrefRowLabel({
  label,
  hint,
  info,
}: {
  label: string;
  hint?: string;
  info?: ReactNode;
}) {
  return (
    <div data-slot="label" className="min-w-0">
      <p className={`flex items-center ${ICON_GAP.row} text-sm font-medium`}>
        {label}
        {info !== undefined && <InfoPopover label={label}>{info}</InfoPopover>}
      </p>
      {hint !== undefined && <p className="mt-0.5 text-xs text-fg-muted">{hint}</p>}
    </div>
  );
}

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
    // ui-field: a theme may lay the label and the control out its own way (stacked, or as a
    // table row); the hint rides inside the label slot, under the label, in every theme.
    <div className="ui-field flex items-center justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
      <PrefRowLabel label={label} hint={hint} info={info} />
      <div data-slot="control" className="shrink-0">
        {children}
      </div>
    </div>
  );
}

/**
 * One row of a settings list: a title plus a one-line description on the left, the control (if
 * any) on the right. Rows are separated by the parent container's `divide-y` rules (ruled
 * sections, not card boxes). Plainer than {@link PrefRow}: the title is set in the body weight,
 * the description in the subtle ink, and a row may carry no control at all (a fact, or why an
 * action is unavailable).
 */
export function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-sm">{title}</p>
        {description !== undefined && (
          <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>
        )}
      </div>
      {children !== undefined && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/**
 * The frame of a settings page that saves explicitly: the body, and a trailing action row. The
 * dialog pane already draws the page heading and the "?" that discloses what the page is, so the
 * section adds no title, no explanatory line and no box of its own. Pages that apply on the spot
 * pass no actions and the row is not drawn, so nothing on screen suggests an unsaved edit is
 * waiting.
 */
export function SettingsSection({
  actions,
  children,
}: {
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="space-y-4">{children}</div>
      {actions !== undefined && (
        <div className="mt-5 flex justify-end gap-2 border-t border-line-muted pt-4">{actions}</div>
      )}
    </section>
  );
}
