/**
 * A settings group's `table` field (the Sandbox card's presets), drawn inside a rounded,
 * hairline-bordered box. The layout is fixed: every `enum` column gets the same width, the
 * small columns (a pin, a row choice, the handle) get just their control, and the text column
 * takes the rest and wraps. On a screen too narrow for that the box scrolls sideways.
 *
 * The table's title, every column header and a column group's header carry a "?" disclosing
 * what they mean (the schema's `description`s), never a paragraph on screen.
 *
 * Cells by column type: a `string` cell is a box holding the effective text (an empty override
 * shows the declared text, in the page's language; clearing it or typing the declared text back
 * restores it), which wraps; a `boolean` cell is a switch, or a pin toggle for the column the
 * table's `pin` names; an `enum` cell is its value's full title as text, which opens a menu of
 * the options (plugin-config-enum-cell.tsx). A cell the row locks is the value's text alone,
 * with "locked" in its name and tooltip. A `rowChoice` column marks the chosen row with a badge
 * and offers "Set as …" on the others, shown on row hover or focus and always reachable by Tab.
 *
 * An `extensible` table leads every row with a drag handle (the arrow keys move a focused one),
 * ends an added row with a delete button, and has an add button under it. Every control is
 * named "<row> · <column>" (or after its action) for a screen reader, the row's name in the
 * page's language.
 */
import { useEffect, useRef } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigTableColumn,
  PluginConfigTableRow,
} from "@prismshadow/penguin-server/api";
import { Button, GlyphIcon, ICONS, ICON_SIZE, InfoPopover, Switch } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import type { TableDraft } from "./plugin-config-draft";
import { EnumCell } from "./plugin-config-enum-cell";
import { PinToggle, RowGrip, WrappingNameBox } from "./plugin-config-table-cells";

/**
 * Column widths, in the table's fixed layout. Equal for every choice column so none reads wider
 * than its siblings; sized together so the sandbox's presets fit the settings dialog at its
 * default width with the name column taking what is left.
 */
const WIDTH = {
  enum: "w-[6.25rem]",
  pin: "w-[3rem]",
  choice: "w-[4.75rem]",
  boolean: "w-[3.25rem]",
  handle: "w-8",
  remove: "w-8",
} as const;

const TH = "px-1 py-2 text-left text-xs font-medium text-fg-muted";

/** A header's title and its "?" — the title is the "?"'s anchor, so they share one element. */
function HeaderTitle({ title, info }: { title: string; info: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      {title}
      {info !== undefined && <InfoPopover label={title}>{info}</InfoPopover>}
    </span>
  );
}

/** One drawn column: a field column, or the row choice's. */
type Slot = { kind: "column"; column: PluginConfigTableColumn } | { kind: "choice" };

/** A row as drawn: its declared form (absent for an added row) and its cells. */
interface DrawnRow {
  id: string;
  declared?: PluginConfigTableRow;
  cells: Record<string, string | boolean>;
}

/** A fresh id for an added row: lower-case, never a declared one. */
const newRowId = () => `added-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function ConfigTable({
  entry,
  name,
  field,
  table,
  onChange,
  choice,
  onChoice,
  errors,
  disabled,
  locale,
}: {
  entry: PluginConfigEntry;
  name: string;
  field: PluginConfigField;
  table: TableDraft;
  onChange: (next: TableDraft) => void;
  /** The row the table's single-choice column (`rowChoice`) holds, as drafted. */
  choice?: unknown;
  onChoice?: (row: string) => void;
  /** The refused cells' messages, listed under the table. */
  errors: string[];
  disabled: boolean;
  locale: Locale;
}) {
  const localized = (en: string, zh: string | undefined) => localizedText(locale, en, zh);
  const described = (d: { description?: string; descriptionZh?: string }) =>
    d.description !== undefined ? localized(d.description, d.descriptionZh) : undefined;
  const label = localized(field.title, field.titleZh);
  const info = described(field);
  const { rowChoice, pin, columnGroup, extensible } = field;

  // The columns in drawing order: the row choice slots in before the column it names.
  const slots: Slot[] = [];
  for (const column of field.columns ?? []) {
    if (rowChoice !== undefined && rowChoice.before === column.name) slots.push({ kind: "choice" });
    slots.push({ kind: "column", column });
  }
  if (rowChoice !== undefined && !slots.some((s) => s.kind === "choice")) {
    slots.push({ kind: "choice" });
  }
  const slotName = (slot: Slot) => (slot.kind === "choice" ? rowChoice!.field : slot.column.name);
  const grouped = (slot: Slot) => columnGroup?.columns.includes(slotName(slot)) === true;
  const widthOf = (slot: Slot) =>
    slot.kind === "choice"
      ? WIDTH.choice
      : slot.column.type === "enum"
        ? WIDTH.enum
        : slot.column.type === "boolean"
          ? pin?.column === slot.column.name
            ? WIDTH.pin
            : WIDTH.boolean
          : "";
  const slotTitle = (slot: Slot) =>
    slot.kind === "choice"
      ? localized(rowChoice!.title, rowChoice!.titleZh)
      : localized(slot.column.title, slot.column.titleZh);
  const slotInfo = (slot: Slot) =>
    slot.kind === "choice" ? described(rowChoice!) : described(slot.column);

  const declared = new Map((field.rows ?? []).map((r) => [r.id, r]));
  const rows: DrawnRow[] = table.order.flatMap((id): DrawnRow[] => {
    const row = declared.get(id);
    if (row !== undefined) return [{ id, declared: row, cells: table.rows[id] ?? {} }];
    const added = table.added[id];
    return added !== undefined ? [{ id, cells: added }] : [];
  });
  const rowName = (row: DrawnRow) => {
    const typed = row.cells.name;
    if (typeof typed === "string" && typed !== "") return typed;
    return row.declared !== undefined
      ? localized(String(row.declared.values.name ?? row.id), row.declared.valuesZh?.name)
      : row.id;
  };

  const setCell = (row: DrawnRow, column: string, value: string | boolean) =>
    onChange(
      row.declared !== undefined
        ? { ...table, rows: { ...table.rows, [row.id]: { ...row.cells, [column]: value } } }
        : { ...table, added: { ...table.added, [row.id]: { ...row.cells, [column]: value } } },
    );
  const moveTo = (id: string, index: number) => {
    const from = table.order.indexOf(id);
    const to = Math.max(0, Math.min(table.order.length - 1, index));
    if (from === -1 || from === to) return;
    const order = table.order.filter((x) => x !== id);
    order.splice(to, 0, id);
    onChange({ ...table, order });
  };
  const remove = (row: DrawnRow) => {
    const { [row.id]: _gone, ...added } = table.added;
    onChange({ ...table, added, order: table.order.filter((x) => x !== row.id) });
  };
  const add = () => {
    if (extensible === undefined) return;
    const id = newRowId();
    const values = Object.fromEntries(
      (field.columns ?? []).map((c) => [
        c.name,
        c.type === "string"
          ? localized(String(extensible.values[c.name] ?? ""), extensible.valuesZh?.[c.name])
          : extensible.values[c.name]!,
      ]),
    );
    onChange({ ...table, added: { ...table.added, [id]: values }, order: [...table.order, id] });
  };

  // Rows by id, for a drag to find which row the pointer is over; a handle that moved its row
  // by keyboard keeps the focus.
  const rowEls = useRef(new Map<string, HTMLTableRowElement>());
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    grips.current.get(refocus.current)?.focus();
    refocus.current = null;
  });
  const dragTo = (id: string, clientY: number) => {
    const index = table.order.findIndex((other) => {
      const box = rowEls.current.get(other)?.getBoundingClientRect();
      return box !== undefined && clientY < box.top + box.height / 2;
    });
    const target = index === -1 ? table.order.length - 1 : index;
    const from = table.order.indexOf(id);
    // Crossing into the lower half of the next row moves it below that row.
    moveTo(id, target > from ? target - 1 : target);
  };

  const head = (slot: Slot, rowSpan?: number) => (
    <th
      key={slotName(slot)}
      scope="col"
      {...(rowSpan !== undefined ? { rowSpan } : {})}
      className={`${TH} ${slot.kind === "choice" || slot.column.type === "boolean" ? "text-center" : ""}`}
    >
      <HeaderTitle title={slotTitle(slot)} info={slotInfo(slot)} />
    </th>
  );
  const groupedSlots = slots.filter(grouped);
  const twoRows = columnGroup !== undefined && groupedSlots.length > 0;
  const span = twoRows ? 2 : undefined;

  return (
    <div className="space-y-1.5">
      <p className="inline-flex items-center gap-1 text-sm font-medium">
        {label}
        {info !== undefined && <InfoPopover label={label}>{info}</InfoPopover>}
      </p>
      {field.hint !== undefined && (
        <p className="text-xs text-fg-muted">{localized(field.hint, field.hintZh)}</p>
      )}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[30rem] table-fixed border-collapse text-sm">
          <colgroup>
            {extensible !== undefined && <col className={WIDTH.handle} />}
            {slots.map((slot) => (
              <col key={slotName(slot)} className={widthOf(slot)} />
            ))}
            {extensible !== undefined && <col className={WIDTH.remove} />}
          </colgroup>
          <thead className="bg-surface-muted">
            <tr>
              {extensible !== undefined && <th aria-hidden {...(span ? { rowSpan: span } : {})} />}
              {slots.map((slot, i) => {
                if (!twoRows || !grouped(slot)) return head(slot, span);
                // The group's header stands once, over its first column, spanning them all.
                if (slots.findIndex(grouped) !== i) return null;
                const title = localized(columnGroup!.title, columnGroup!.titleZh);
                return (
                  <th
                    key="group"
                    scope="colgroup"
                    colSpan={groupedSlots.length}
                    className={`${TH} border-b border-line-muted text-center`}
                  >
                    <HeaderTitle title={title} info={described(columnGroup!)} />
                  </th>
                );
              })}
              {extensible !== undefined && <th aria-hidden {...(span ? { rowSpan: span } : {})} />}
            </tr>
            {twoRows && <tr>{groupedSlots.map((slot) => head(slot))}</tr>}
          </thead>
          <tbody>
            {rows.map((row) => {
              const name_ = rowName(row);
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el === null) rowEls.current.delete(row.id);
                    else rowEls.current.set(row.id, el);
                  }}
                  className="group border-t border-line-muted transition-colors duration-150 hover:bg-surface-muted/60 focus-within:bg-surface-muted/60"
                >
                  {extensible !== undefined && (
                    <td className="px-1 py-1.5 text-center align-middle">
                      <RowGrip
                        row={name_}
                        disabled={disabled}
                        gripRef={(el) => {
                          if (el === null) grips.current.delete(row.id);
                          else grips.current.set(row.id, el);
                        }}
                        onStep={(by) => {
                          refocus.current = row.id;
                          moveTo(row.id, table.order.indexOf(row.id) + by);
                        }}
                        onDrag={(y) => dragTo(row.id, y)}
                      />
                    </td>
                  )}
                  {slots.map((slot) =>
                    slot.kind === "choice" ? (
                      <td key="choice" className="px-1 py-1.5 text-center align-middle">
                        {choice === row.id ? (
                          <span className="inline-block rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-fg">
                            {slotTitle(slot)}
                          </span>
                        ) : (
                          // Hidden until the row is pointed at or focused; Tab still reaches it,
                          // and focus shows it.
                          <button
                            type="button"
                            aria-label={`${name_} · ${S.settings.pluginTableChoose(slotTitle(slot))}`}
                            disabled={disabled}
                            onClick={() => onChoice?.(row.id)}
                            className="rounded-md px-1 py-0.5 text-xs text-fg-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:cursor-not-allowed"
                          >
                            {S.settings.pluginTableChoose(slotTitle(slot))}
                          </button>
                        )}
                      </td>
                    ) : (
                      <Cell
                        key={slot.column.name}
                        entry={entry}
                        name={name}
                        column={slot.column}
                        row={row}
                        rowName={name_}
                        pinned={pin?.column === slot.column.name ? pin : undefined}
                        localized={localized}
                        disabled={disabled}
                        onCell={(value) => setCell(row, slot.column.name, value)}
                      />
                    ),
                  )}
                  {extensible !== undefined && (
                    <td className="px-1 py-1.5 text-center align-middle">
                      {row.declared === undefined && (
                        <button
                          type="button"
                          aria-label={S.settings.pluginTableDelete(name_)}
                          data-tooltip={S.settings.pluginTableDelete(name_)}
                          disabled={disabled}
                          onClick={() => remove(row)}
                          className="inline-flex size-6 items-center justify-center rounded-md align-middle text-fg-subtle transition-colors duration-150 hover:bg-surface-muted hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <GlyphIcon d={ICONS.trash} size={ICON_SIZE.inlineGlyph} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {extensible !== undefined && (
        <Button size="sm" variant="secondary" disabled={disabled} onClick={add}>
          {extensible.add !== undefined
            ? localized(extensible.add, extensible.addZh)
            : S.settings.pluginTableAdd}
        </Button>
      )}
      {errors.map((text, i) => (
        <p key={i} className={`text-xs ${toneInk.danger}`}>
          {text}
        </p>
      ))}
    </div>
  );
}

/** One field cell of a row, by its column's type (see the module's header). */
function Cell({
  entry,
  name,
  column: c,
  row,
  rowName,
  pinned,
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
  return (
    <td className={`px-1 py-1.5 align-middle ${c.type === "boolean" ? "text-center" : ""}`}>
      {locked ? (
        // The value alone: no control to suggest it could change. "Locked" is in the name and
        // the tooltip.
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
              cell === true
                ? localized(pinned.on, pinned.onZh)
                : localized(pinned.off, pinned.offZh)
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
          onChange={(value) =>
            onCell(row.declared !== undefined && value === declared ? "" : value)
          }
        />
      )}
    </td>
  );
}
