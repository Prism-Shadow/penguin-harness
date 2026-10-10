/**
 * The settings page's row primitives: a labelled preference row — title on the left, the control
 * on the right — stacked in a group's ruled list ({@link SettingsGroup}) so rows separate with
 * rules rather than boxes; the plainer row of a settings list with a one-line description; and
 * the section frame with its ruled action row.
 *
 * A row titles a control it does not own, so its title is a `<p>`, never a `<label>`: a label
 * would name its first labelable descendant, which beside a "?" is the disclosure button rather
 * than the control. A switch row with that shape is `ToggleRow`.
 *
 * Every preference row keeps one pitch, whatever its control: its first line is the settings
 * line ({@link FIELD_LINE}), the control is centred in it and the title's line is centred on it,
 * so the titles of a page of rows stand at even intervals. A hint adds its own lines under the
 * title and nothing else; a control taller than the line (an avatar, a field with its error
 * under it) grows the row downward with the title held on the first line.
 */
import type { ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { Text } from "../../content/typography/typography";
import { InfoPopover } from "../../overlays/info-popover/info-popover";

/**
 * The settings line: the height of a preference row's first line, which is the tallest control
 * such a row holds — the Segmented well, its `p-1` inset and its chips' `py-1` around one line of
 * the small rung. A switch, the swatches, a select, a button or a text field is centred in it.
 * Spelled whole (Tailwind emits only the class names it finds in the source).
 */
const FIELD_LINE =
  "min-h-[calc(var(--ui-space-unit)*4_+_var(--ui-text-small-size)*var(--ui-text-small-lh))]";

/**
 * The title's offset into that line: half of what the line has over the title's own line (the
 * body rung's), so the title's line is centred on the control's whatever the theme's type scale.
 * A title that wraps (a theme may give it a fixed column) keeps its first line there.
 */
const FIELD_LINE_TITLE =
  "pt-[calc(var(--ui-space-unit)*2_+_(var(--ui-text-small-size)*var(--ui-text-small-lh)_-_var(--ui-text-body-size)*var(--ui-text-body-lh))/2)]";

/**
 * The label slot of a toggle row's plain and card frames: the title with its "?" beside it, and
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
   * `info` so a reader who already knows is not made to scroll past it again. A node, so a
   * caller can set it in a tone; the row sets its rung and its muted ink.
   */
  hint?: ReactNode;
  /** Semantic explanation, disclosed by a "?" beside the label. */
  info?: ReactNode;
  children: ReactNode;
}) {
  return (
    // ui-field: a theme may lay the slots out its own way (a band, a table row). The host's grid:
    // the title's column keeps the title on one line and takes the room the control leaves; the
    // control's column is the control's width and gives first when both do not fit (a group of
    // controls wraps, a segmented control narrows). The control spans the hint's row, so the
    // hint follows the title directly, never pushed down by a control taller than the title.
    <div className="ui-field grid grid-cols-[minmax(min-content,1fr)_minmax(0,max-content)] items-start gap-x-4 py-3.5 first:pt-0 last:pb-0">
      <div
        data-slot="label"
        className={`col-start-1 row-start-1 whitespace-nowrap ${FIELD_LINE_TITLE}`}
      >
        <p className={`flex items-center ${ICON_GAP.row} text-sm font-medium`}>
          {label}
          {info !== undefined && <InfoPopover label={label}>{info}</InfoPopover>}
        </p>
      </div>
      <div
        data-slot="control"
        className={`col-start-2 row-span-2 row-start-1 flex min-w-0 items-center justify-end ${FIELD_LINE}`}
      >
        {children}
      </div>
      {hint !== undefined && (
        <p data-slot="hint" className="col-start-1 row-start-2 mt-0.5 text-xs text-fg-muted">
          {hint}
        </p>
      )}
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
 * A run of preference rows: the ruled list they stack in, under an optional group title (the
 * eyebrow rung, a heading in the dialog's outline). Every settings page lays its rows in one, so
 * the rules between rows and the title's distance from its first row are the same on every page,
 * and a theme that sets the rows as a grouped band (Frost) rounds each group on its own. Groups
 * on one page, and a group and the block after it, stand six space units apart (`space-y-6`,
 * `mt-6`), the one section gap of every settings page.
 */
export function SettingsGroup({ title, children }: { title?: string; children: ReactNode }) {
  const rows = <div className="divide-y divide-line-muted">{children}</div>;
  if (title === undefined) return rows;
  return (
    <section>
      {/* A flex heading, so the line box is the eyebrow's own rather than the inherited one. */}
      <h3 className="mb-2 flex">
        <Text variant="eyebrow" as="span">
          {title}
        </Text>
      </h3>
      {rows}
    </section>
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
        <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-line-muted pt-4">
          {actions}
        </div>
      )}
    </section>
  );
}
