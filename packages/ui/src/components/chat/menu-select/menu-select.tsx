/**
 * The toolbar select: a `ToolbarTrigger` that opens a menu of choices in the shared panel — the
 * pickers along a composer's toolbar (a thinking level, the input add-ons, the skills a message
 * is sent with) and any row of compact controls like them.
 *
 * The panel may open with a title bar naming the control (`title`), since its rows are only the
 * choices' own short names. The rows are the Menu family's at the small rung: a leading glyph,
 * the label with an optional muted `detail` running on after it on the same line (and giving way
 * first), and the check on the chosen one. Below them, either a muted footnote (`note`) or a row
 * of settings under a rule (`footer`). A picker whose body is not a list of choices — a search
 * over a long list — passes it as `children` instead of `options`.
 *
 * `value` is the chosen choice, or the chosen ones: with `multiple` every row is a toggle, marked
 * pressed while it is on. A pick closes the menu unless `keepOpen`; the trigger toggles it, and
 * the Dropdown underneath closes it on Escape and on a click outside. The panel is portaled, so a
 * toolbar that scrolls sideways cannot clip it, and it opens `up` from a composer docked at the
 * page's foot, `down` from one with the room below.
 *
 * The rows are plain buttons, as in every picker the app opens from a toolbar: the choices keep
 * the names they are found by.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Dropdown } from "../../overlays/dropdown/dropdown";
import { MenuItem } from "../../overlays/menu/menu";
import { ToolbarTrigger } from "../composer/toolbar-trigger";
import type { ToolbarTriggerProps } from "../composer/toolbar-trigger";

export interface MenuSelectOption<V extends string> {
  value: V;
  label: ReactNode;
  /** A registry path (drawn muted and decorative) or a node the caller sized. */
  glyph?: string | ReactNode;
  /** Muted words after the label on the same line: what the choice does. */
  detail?: ReactNode;
  /** Listed, greyed out and inert (the menu still opens). */
  disabled?: boolean;
  /** A muted note at the row's end. */
  trailing?: ReactNode;
}

/** A menu's title bar: the control's name above rows that carry only the choices' own names. */
export function MenuTitle({ children }: { children: ReactNode }) {
  return (
    <div className="border-b border-line-muted px-3 pb-1.5 pt-0.5 text-xs font-semibold text-fg-muted">
      {children}
    </div>
  );
}

/** Whether an optional slot has anything to draw. */
const shown = (node: ReactNode): boolean => node !== undefined && node !== null && node !== "";

/** What `MenuSelect` opens: the title, the rows (or the caller's body), a note or a footer. */
export interface MenuSelectBodyProps<V extends string> {
  /** The title bar's text. */
  title?: ReactNode;
  options?: readonly MenuSelectOption<V>[];
  /** The chosen choice, or the chosen ones; null while there is nothing to show yet. */
  value?: V | readonly V[] | null;
  /** A row was picked. */
  onPick?: (value: V) => void;
  /** Every row is a toggle (`aria-pressed`), so several may be on at once. */
  multiple?: boolean;
  /** A muted footnote under the rows. */
  note?: ReactNode;
  /** A row of settings under a rule, after the rows. */
  footer?: ReactNode;
  /** The panel's body in place of `options` (a search over a long list). */
  children?: ReactNode;
}

/** The open panel's contents, on their own: what `MenuSelect` renders inside its Dropdown. */
export function MenuSelectBody<V extends string>({
  title,
  options,
  value,
  onPick,
  multiple = false,
  note,
  footer,
  children,
}: MenuSelectBodyProps<V>) {
  const chosen = (v: V): boolean => (Array.isArray(value) ? value.includes(v) : value === v);
  return (
    <>
      {shown(title) && <MenuTitle>{title}</MenuTitle>}
      {children ??
        options?.map((option) => (
          <MenuItem
            key={option.value}
            density="sm"
            {...(multiple ? { "aria-pressed": chosen(option.value) } : {})}
            disabled={option.disabled ?? false}
            checked={chosen(option.value)}
            glyph={option.glyph}
            label={
              shown(option.detail) ? (
                <>
                  {option.label} <span className="text-fg-subtle">{option.detail}</span>
                </>
              ) : (
                option.label
              )
            }
            trailing={option.trailing}
            onSelect={() => onPick?.(option.value)}
          />
        ))}
      {shown(note) && (
        <div className="max-w-56 border-t border-line-muted px-3 pb-1 pt-1.5 text-xs leading-snug text-fg-subtle">
          {note}
        </div>
      )}
      {shown(footer) && <div className="mt-1 border-t border-line-muted pt-1">{footer}</div>}
    </>
  );
}

export function MenuSelect<V extends string>({
  trigger,
  title,
  options,
  value,
  onChange,
  multiple = false,
  keepOpen = false,
  note,
  footer,
  children,
  direction = "up",
  align = "left",
  menuClass = "w-max min-w-36",
}: Omit<MenuSelectBodyProps<V>, "onPick"> & {
  /** The button: its mark, words, name and state (the open state is the menu's own). */
  trigger: Omit<ToolbarTriggerProps, "expanded" | "onClick">;
  onChange?: (value: V) => void;
  /** A pick leaves the menu open (a checklist being filled in). */
  keepOpen?: boolean;
  direction?: "up" | "down";
  /** Which of the panel's edges lines up with the trigger's. */
  align?: "left" | "right";
  /** The panel's width classes; placement is measured from the trigger. */
  menuClass?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass={menuClass}
      portal={{ direction, align }}
      button={<ToolbarTrigger {...trigger} expanded={open} onClick={() => setOpen(!open)} />}
    >
      <MenuSelectBody<V>
        title={title}
        options={options}
        value={value}
        multiple={multiple}
        note={note}
        footer={footer}
        onPick={(picked) => {
          if (!keepOpen) setOpen(false);
          onChange?.(picked);
        }}
      >
        {children}
      </MenuSelectBody>
    </Dropdown>
  );
}
