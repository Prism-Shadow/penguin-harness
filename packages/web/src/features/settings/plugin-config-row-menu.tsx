/**
 * A table row's "…" menu: the operations a row needs less often than its pin and handle —
 * making it the table's chosen row (the sandbox's default preset) and deleting a row an
 * administrator added. Declared rows have no Delete, and the chosen row cannot be deleted
 * (its item stays, disabled, saying why). The panel is the UI package's portaled `Dropdown` with
 * the `Menu` family's rows, like every other menu in the app: opening focuses the first item,
 * the arrow keys move, Enter picks, Esc closes this menu only.
 */
import { useState } from "react";
import { Dropdown, GlyphIcon, ICONS, ICON_SIZE, Menu, MenuItem } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ICON_BUTTON } from "./plugin-config-table-cells";

/** One item of a row's menu; `blocked` says why it cannot be used now. */
export interface RowAction {
  id: "choose" | "delete";
  label: string;
  glyph: string;
  danger?: boolean;
  blocked?: string;
  run: () => void;
}

/**
 * The items a row's menu offers: Set as default where the table has a row choice, and Delete
 * on an added row. Empty when the row has neither.
 */
export function rowActions({
  chosen,
  canChoose,
  added,
  onChoose,
  onDelete,
}: {
  /** The row is the table's chosen one. */
  chosen: boolean;
  /** The table has a row choice. */
  canChoose: boolean;
  /** The row was added to an extensible table, so it may be deleted. */
  added: boolean;
  onChoose: () => void;
  onDelete: () => void;
}): RowAction[] {
  const actions: RowAction[] = [];
  if (canChoose) {
    actions.push({
      id: "choose",
      label: S.settings.pluginTableChoose,
      glyph: ICONS.star,
      ...(chosen ? { blocked: S.settings.pluginTableChosen } : {}),
      run: onChoose,
    });
  }
  if (added) {
    actions.push({
      id: "delete",
      label: S.settings.pluginTableDelete,
      glyph: ICONS.trash,
      danger: true,
      ...(chosen ? { blocked: S.settings.pluginTableDeleteChosen } : {}),
      run: onDelete,
    });
  }
  return actions;
}

export function RowMenu({
  row,
  actions,
  disabled,
}: {
  /** The row's name, for the button's accessible name. */
  row: string;
  actions: RowAction[];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-56"
      portal={{ direction: "down", align: "right" }}
      button={
        <button
          type="button"
          aria-label={S.settings.pluginTableRowMenu(row)}
          aria-haspopup="menu"
          aria-expanded={open}
          data-tooltip={S.settings.pluginTableRowMenuHint}
          disabled={disabled}
          onClick={() => setOpen(!open)}
          className={ICON_BUTTON}
        >
          <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
        </button>
      }
    >
      <Menu label={S.settings.pluginTableRowMenu(row)} density="sm" className="py-1">
        {actions.map((a) => (
          <MenuItem
            key={a.id}
            glyph={a.glyph}
            label={a.label}
            {...(a.danger === true ? { danger: true } : {})}
            {...(a.blocked !== undefined ? { disabled: true, description: a.blocked } : {})}
            onSelect={() => {
              setOpen(false);
              a.run();
            }}
          />
        ))}
      </Menu>
    </Dropdown>
  );
}
