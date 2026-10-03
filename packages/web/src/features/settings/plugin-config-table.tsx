/**
 * A settings group's `table` field (the Sandbox card's presets), drawn inside a rounded,
 * hairline-bordered box. The layout is fixed: every `enum` column gets the same width, the
 * small columns (a pin, the handle, the "…" menu) get just their control, and the text column
 * takes the rest and wraps. On a screen too narrow for that the box scrolls sideways.
 *
 * The table's title, every column header and a column group's header carry a "?" disclosing
 * what they mean (the schema's `description`s), never a paragraph on screen.
 *
 * Cells by column type are plugin-config-field-cell.tsx's. The row's name (its `name` column)
 * is followed by the chosen row's marker ("(Default)", the `rowChoice`'s title) and a "?" saying
 * what the row is for: its declared `description` while its choices are the declared ones, else
 * each choice's value and what that option does.
 *
 * An `extensible` table ends every row with a drag handle (the arrow keys move a focused one),
 * and has an add button under it. A drag lifts the row and moves it with the pointer, shows a
 * line where it will land, and reorders once, on the drop; Esc puts it back. A row's "…" menu
 * (plugin-config-row-menu.tsx) holds what is used less often: Set as default, and Delete on an
 * added row. The handle and the menu join the column group when it ends the columns. Every
 * control is named "<row> · <column>" (or after its action) for a screen reader, the row's name
 * in the page's language.
 */
import { useEffect, useRef, useState } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigTableColumn,
} from "@prismshadow/penguin-server/api";
import { Button, InfoPopover } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import type { TableDraft } from "./plugin-config-draft";
import { Cell, rowHelp } from "./plugin-config-field-cell";
import type { DrawnRow } from "./plugin-config-field-cell";
import { RowMenu, rowActions } from "./plugin-config-row-menu";
import { RowGrip } from "./plugin-config-table-cells";

/** The column a row is named by: its text is the row's name, followed by the row's marks. */
const NAME_COLUMN = "name";

/**
 * Column widths, in the table's fixed layout. Equal for every choice column so none reads wider
 * than its siblings, one width for every icon column (the action group), and a floor under the
 * name (and its marks): below the table's minimum width its box scrolls sideways rather than
 * crushing names.
 */
const WIDTH = {
  enum: "w-[6.25rem]",
  icon: "w-7",
  boolean: "w-[3.25rem]",
} as const;
/** Name floor (7.75rem) + three choice columns + three icon columns. */
const TABLE_MIN = "min-w-[31.75rem]";

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

/** One drawn column: a field column, an extensible table's handle, or the row's "…" menu. */
type Slot = { kind: "column"; column: PluginConfigTableColumn } | { kind: "move" } | { kind: "more" };

/**
 * A drag in progress: the row, how far the pointer has moved, and where the row would land
 * among the others (an index into the order without it). Nothing is reordered until the drop,
 * so the handle holding the pointer capture never moves in the DOM.
 */
interface Drag {
  id: string;
  startY: number;
  dy: number;
  /** The other rows' vertical midpoints, measured once when the drag starts. */
  mids: number[];
  /** The dragged row's own midpoint at the start. */
  mid: number;
  target: number;
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
  /** The row the table's single choice (`rowChoice`) holds, as drafted. */
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

  // The columns in drawing order: an extensible table's handle and the "…" menu come last —
  // inside the column group when it ends there.
  const slots = (field.columns ?? []).map((column): Slot => ({ kind: "column", column }));
  const lastField = slots.length - 1;
  if (extensible !== undefined) slots.push({ kind: "move" });
  if (extensible !== undefined || rowChoice !== undefined) slots.push({ kind: "more" });
  const slotKey = (slot: Slot) => (slot.kind === "column" ? slot.column.name : slot.kind);
  const isIcon = (slot: Slot) => slot.kind !== "column" || pin?.column === slot.column.name;
  const grouped = (slot: Slot, i: number) => {
    if (columnGroup === undefined) return false;
    if (slot.kind !== "column") {
      // The row controls join the group when the group is what the field columns end with.
      const last = slots[lastField];
      return last !== undefined && columnGroup.columns.includes(slotKey(last)) && i > lastField;
    }
    return columnGroup.columns.includes(slotKey(slot));
  };
  const widthOf = (slot: Slot) =>
    isIcon(slot)
      ? WIDTH.icon
      : slot.kind === "column" && slot.column.type === "enum"
        ? WIDTH.enum
        : slot.kind === "column" && slot.column.type === "boolean"
          ? WIDTH.boolean
          : "";
  const slotTitle = (slot: Slot) =>
    slot.kind === "column" ? localized(slot.column.title, slot.column.titleZh) : "";
  const slotInfo = (slot: Slot) => (slot.kind === "column" ? described(slot.column) : undefined);

  const declared = new Map((field.rows ?? []).map((r) => [r.id, r]));
  const rows: DrawnRow[] = table.order.flatMap((id): DrawnRow[] => {
    const row = declared.get(id);
    if (row !== undefined) return [{ id, declared: row, cells: table.rows[id] ?? {} }];
    const added = table.added[id];
    return added !== undefined ? [{ id, cells: added }] : [];
  });
  const rowName = (row: DrawnRow) => {
    const typed = row.cells[NAME_COLUMN];
    if (typeof typed === "string" && typed !== "") return typed;
    return row.declared !== undefined
      ? localized(
          String(row.declared.values[NAME_COLUMN] ?? row.id),
          row.declared.valuesZh?.[NAME_COLUMN],
        )
      : row.id;
  };
  /** What a row is for, behind the "?" after its name: one line, or a line per choice. */
  const helpOf = (row: DrawnRow) => {
    const help = rowHelp(field.columns ?? [], row, localized);
    return Array.isArray(help)
      ? help.map((line, i) => (
          <span key={i} className="block">
            {line}
          </span>
        ))
      : help;
  };

  const setCell = (row: DrawnRow, column: string, value: string | boolean) =>
    onChange(
      row.declared !== undefined
        ? { ...table, rows: { ...table.rows, [row.id]: { ...row.cells, [column]: value } } }
        : { ...table, added: { ...table.added, [row.id]: { ...row.cells, [column]: value } } },
    );
  /** Puts a row at `index` of the order without it. */
  const placeAt = (id: string, index: number) => {
    const rest = table.order.filter((x) => x !== id);
    const at = Math.max(0, Math.min(rest.length, index));
    if (table.order.indexOf(id) === at) return;
    rest.splice(at, 0, id);
    onChange({ ...table, order: rest });
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

  // Rows by id, to measure them when a drag starts; a handle that moved its row by keyboard
  // keeps the focus after the rows re-render in their new order.
  const rowEls = useRef(new Map<string, HTMLTableRowElement>());
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    grips.current.get(refocus.current)?.focus();
    refocus.current = null;
  });
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const midOf = (id: string) => {
    const box = rowEls.current.get(id)?.getBoundingClientRect();
    return box === undefined ? 0 : box.top + box.height / 2;
  };
  const startDrag = (id: string, clientY: number) => {
    const others = table.order.filter((x) => x !== id);
    const next: Drag = {
      id,
      startY: clientY,
      dy: 0,
      mids: others.map(midOf),
      mid: midOf(id),
      target: table.order.indexOf(id),
    };
    setDrag(next);
  };
  const moveDrag = (clientY: number) => {
    const d = dragRef.current;
    if (d === null) return;
    const dy = clientY - d.startY;
    // Where the dragged row's middle now sits among the others' middles.
    const target = d.mids.filter((m) => m < d.mid + dy).length;
    setDrag({ ...d, dy, target });
  };
  const endDrag = (commit: boolean) => {
    const d = dragRef.current;
    setDrag(null);
    if (commit && d !== null) placeAt(d.id, d.target);
  };
  // Esc puts a dragged row back where it was.
  useEffect(() => {
    if (drag === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      endDrag(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  // The drop line: on top of the row the dragged one would land before, or under the last.
  const others = drag === null ? [] : table.order.filter((x) => x !== drag.id);
  const dropBefore = drag === null ? null : (others[drag.target] ?? null);
  const dropAfterLast = drag !== null && drag.target >= others.length;

  const groupSlots = slots.filter(grouped);
  const groupTitle =
    columnGroup !== undefined ? localized(columnGroup.title, columnGroup.titleZh) : "";

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
        <table className={`w-full ${TABLE_MIN} table-fixed border-collapse text-sm`}>
          <colgroup>
            {slots.map((slot) => (
              <col key={slotKey(slot)} className={widthOf(slot)} />
            ))}
          </colgroup>
          <thead className="bg-surface-muted">
            <tr>
              {slots.map((slot, i) => {
                if (grouped(slot, i)) {
                  // The group's header stands once, over its first column, spanning them all:
                  // its "?" says what each icon in it does.
                  if (slots.findIndex(grouped) !== i) return null;
                  return (
                    <th
                      key="group"
                      scope="colgroup"
                      colSpan={groupSlots.length}
                      className={`${TH} text-center`}
                    >
                      <HeaderTitle title={groupTitle} info={described(columnGroup!)} />
                    </th>
                  );
                }
                if (slot.kind !== "column") return <th key={slot.kind} aria-hidden />;
                return (
                  <th
                    key={slotKey(slot)}
                    scope="col"
                    className={`${TH} ${isIcon(slot) ? "text-center" : ""}`}
                  >
                    <HeaderTitle title={slotTitle(slot)} info={slotInfo(slot)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rowLabel = rowName(row);
              const dy = drag !== null && drag.id === row.id ? drag.dy : null;
              const dragging = dy !== null;
              const lineAbove = dropBefore === row.id;
              const lineBelow = dropAfterLast && row.id === others[others.length - 1];
              const chosen = choice === row.id;
              return (
                <tr
                  key={row.id}
                  ref={(el) => {
                    if (el === null) rowEls.current.delete(row.id);
                    else rowEls.current.set(row.id, el);
                  }}
                  // Lifted while dragged: it follows the pointer by transform, above the rest.
                  style={
                    dragging
                      ? { transform: `translateY(${dy}px)`, position: "relative", zIndex: 1 }
                      : undefined
                  }
                  className={`border-t border-line-muted ${dragging ? "bg-surface shadow-lg" : "transition-colors duration-150 hover:bg-surface-muted/60"} ${lineAbove ? "[&>td]:border-t-2 [&>td]:border-t-accent" : ""} ${lineBelow ? "[&>td]:border-b-2 [&>td]:border-b-accent" : ""}`}
                >
                  {slots.map((slot) => {
                    if (slot.kind === "move") {
                      return (
                        <td key="move" className="px-0.5 py-1.5 text-center align-middle">
                          <RowGrip
                            row={rowLabel}
                            disabled={disabled}
                            gripRef={(el) => {
                              if (el === null) grips.current.delete(row.id);
                              else grips.current.set(row.id, el);
                            }}
                            onStep={(by) => {
                              refocus.current = row.id;
                              placeAt(row.id, table.order.indexOf(row.id) + by);
                            }}
                            onDragStart={(y) => startDrag(row.id, y)}
                            onDragMove={moveDrag}
                            onDragEnd={endDrag}
                          />
                        </td>
                      );
                    }
                    if (slot.kind === "more") {
                      // The cell stays on a row with nothing to offer, empty, so the icons line up.
                      return (
                        <td key="more" className="px-0.5 py-1.5 text-center align-middle">
                          <RowMenu
                            row={rowLabel}
                            disabled={disabled}
                            actions={rowActions({
                              chosen,
                              canChoose: rowChoice !== undefined,
                              added: extensible !== undefined && row.declared === undefined,
                              onChoose: () => onChoice?.(row.id),
                              onDelete: () => remove(row),
                            })}
                          />
                        </td>
                      );
                    }
                    return (
                      <Cell
                        key={slot.column.name}
                        entry={entry}
                        name={name}
                        column={slot.column}
                        row={row}
                        rowName={rowLabel}
                        pinned={pin?.column === slot.column.name ? pin : undefined}
                        {...(slot.column.name === NAME_COLUMN
                          ? {
                              marks: {
                                ...(chosen && rowChoice !== undefined
                                  ? {
                                      marker: S.settings.pluginTableChosenMarker(
                                        localized(rowChoice.title, rowChoice.titleZh),
                                      ),
                                    }
                                  : {}),
                                help: helpOf(row),
                              },
                            }
                          : {})}
                        localized={localized}
                        disabled={disabled}
                        onCell={(value) => setCell(row, slot.column.name, value)}
                      />
                    );
                  })}
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
