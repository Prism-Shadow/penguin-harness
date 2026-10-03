/**
 * One field cell of a settings table's row, by its column's type: a `string` cell is a box
 * holding the effective text (an empty override shows the declared text, in the page's
 * language; clearing it or typing the declared text back restores it), which wraps; a `boolean`
 * cell is a switch, or a pin toggle for the column the table's `pin` names; an `enum` cell is its
 * value's full title as text, which opens a menu of the options (plugin-config-enum-cell.tsx). A
 * cell the row locks is the value's text alone, with "locked" in its name and tooltip.
 *
 * The row's name cell also carries the row's marks after the name: the chosen row's marker
 * ("(Default)") and the "?" saying what the row is for.
 */
import type { ReactNode } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigTableColumn,
  PluginConfigTableRow,
} from "@prismshadow/penguin-server/api";
import { InfoPopover, Switch } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { EnumCell } from "./plugin-config-enum-cell";
import { PinToggle, WrappingNameBox } from "./plugin-config-table-cells";

/** A row as drawn: its declared form (absent for an added row) and its cells. */
export interface DrawnRow {
  id: string;
  declared?: PluginConfigTableRow;
  cells: Record<string, string | boolean>;
}

/** What follows the name in a row's name cell. */
export interface RowMarks {
  /** The chosen row's marker, "(Default)". */
  marker?: string;
  /** What the row is for, behind a "?" named after the row. */
  help?: ReactNode;
}

/**
 * What a row is for: its declared `description` while every `enum` cell holds its declared
 * value; otherwise (an added row, or one whose choices changed) a line per `enum` column with
 * its value and what that option does. Undefined for a row with neither.
 */
export function rowHelp(
  columns: readonly PluginConfigTableColumn[],
  row: DrawnRow,
  localized: (en: string, zh: string | undefined) => string,
): string | string[] | undefined {
  const choices = columns.filter((c) => c.type === "enum");
  const d = row.declared;
  if (
    d?.description !== undefined &&
    choices.every((c) => row.cells[c.name] === d.values[c.name])
  ) {
    return localized(d.description, d.descriptionZh);
  }
  if (choices.length === 0) return undefined;
  return choices.map((c) => {
    const o = c.options?.find((x) => x.value === row.cells[c.name]);
    return S.settings.pluginTableRowValue(
      localized(c.title, c.titleZh),
      o !== undefined ? localized(o.title, o.titleZh) : String(row.cells[c.name]),
      o?.description !== undefined ? localized(o.description, o.descriptionZh) : undefined,
    );
  });
}

export function Cell({
  entry,
  name,
  column: c,
  row,
  rowName,
  pinned,
  marks,
  localized,
  disabled,
  onCell,
}: {
  entry: PluginConfigEntry;
  name: string;
  column: PluginConfigTableColumn;
  row: DrawnRow;
  rowName: string;
  pinned: PluginConfigField["pin"];
  /** Set on the row's name cell only. */
  marks?: RowMarks;
  localized: (en: string, zh: string | undefined) => string;
  disabled: boolean;
  onCell: (value: string | boolean) => void;
}) {
  const cell = row.cells[c.name];
  const locked = row.declared?.locked?.includes(c.name) === true;
  // The declared text, in the page's language; an added row has none (its text is its own).
  const declared =
    row.declared !== undefined
      ? localized(String(row.declared.values[c.name] ?? ""), row.declared.valuesZh?.[c.name])
      : "";
  const cellLabel = `${rowName} · ${localized(c.title, c.titleZh)}`;
  const optionTitle = (value: unknown) => {
    const option = c.options?.find((o) => o.value === value);
    return option !== undefined ? localized(option.title, option.titleZh) : String(value);
  };
  const shown =
    c.type === "enum"
      ? optionTitle(cell)
      : c.type === "string"
        ? cell === ""
          ? declared
          : String(cell)
        : cell === true
          ? S.settings.pluginCellOn
          : S.settings.pluginCellOff;
  const body = locked ? (
    // The value alone: no control to suggest it could change. "Locked" is in the name and the
    // tooltip.
    <span
      aria-label={`${cellLabel}: ${shown} (${S.settings.pluginCellLocked})`}
      data-tooltip={S.settings.pluginCellLocked}
      className="block px-1.5 text-xs break-words text-fg-muted"
    >
      <span aria-hidden>{shown}</span>
    </span>
  ) : c.type === "boolean" ? (
    pinned !== undefined ? (
      <PinToggle
        label={cellLabel}
        pinned={cell === true}
        tooltip={
          cell === true ? localized(pinned.on, pinned.onZh) : localized(pinned.off, pinned.offZh)
        }
        disabled={disabled}
        onChange={onCell}
      />
    ) : (
      <Switch
        aria-label={cellLabel}
        checked={cell === true}
        disabled={disabled}
        onChange={onCell}
      />
    )
  ) : c.type === "enum" ? (
    <EnumCell
      label={cellLabel}
      value={typeof cell === "string" ? cell : ""}
      disabled={disabled}
      onChange={onCell}
      options={(c.options ?? []).map((option) => {
        const off = entry.unavailable?.find(
          (u) => u.field === name && u.column === c.name && u.value === option.value,
        );
        return {
          value: option.value,
          title: localized(option.title, option.titleZh),
          ...(off !== undefined ? { unavailable: localized(off.reason, off.reasonZh) } : {}),
        };
      })}
    />
  ) : (
    <WrappingNameBox
      label={cellLabel}
      // The effective text: an empty override is the declared text, in the page's language.
      // Typing it back, or clearing the box, restores it.
      value={typeof cell === "string" && cell !== "" ? cell : declared}
      disabled={disabled}
      onChange={(value) => onCell(row.declared !== undefined && value === declared ? "" : value)}
    />
  );
  return (
    <td className={`px-1 py-1.5 align-middle ${c.type === "boolean" ? "text-center" : ""}`}>
      {marks === undefined ? (
        body
      ) : (
        // The name first, then its marks; a long name takes the line and the marks wrap under.
        <div className="flex flex-wrap items-center gap-x-1">
          {body}
          {marks.marker !== undefined && (
            <span className="text-xs whitespace-nowrap text-fg-muted">{marks.marker}</span>
          )}
          {marks.help !== undefined && <InfoPopover label={rowName}>{marks.help}</InfoPopover>}
        </div>
      )}
    </td>
  );
}
