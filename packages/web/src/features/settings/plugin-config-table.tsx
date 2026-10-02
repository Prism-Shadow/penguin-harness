/**
 * A settings group's `table` field (the Sandbox card's presets): a fixed set of rows, one value
 * per column, drawn inside a rounded, hairline-bordered box. The layout is fixed: every `enum`
 * column gets the same width and its select fills it, the small columns (a pin, a row choice)
 * get just their control, and the text column takes the rest and wraps. On a screen too narrow
 * for that, the box scrolls sideways rather than squeezing the cells.
 *
 * The table's title and every column header carry a "?" disclosing what they mean (the schema's
 * `description`s), never a paragraph on screen.
 *
 * Each cell is drawn by its column's type: a `string` cell is a borderless box holding the
 * effective text (an empty override shows the declared text, in the page's language; clearing
 * the box or typing the declared text back restores it), which wraps; a `boolean` cell is a
 * switch, or a pin toggle where the column declares `pin`; an `enum` cell is a select, its
 * options this machine cannot honour greyed out with the reason. A cell the row locks is not a
 * control at all: it is the value's text alone — a disabled select would read as broken — with
 * "locked" in its accessible name and tooltip. A table with a `rowChoice` gets one more column
 * of radios, one row chosen (the sandbox's Default preset), stored in the group's own enum
 * field and drawn before the column it names. Every control is named "<row> · <column>" for a
 * screen reader, the row's name in the page's language.
 */
import { useLayoutEffect, useRef } from "react";
import type {
  PluginConfigEntry,
  PluginConfigField,
  PluginConfigTableColumn,
} from "@prismshadow/penguin-server/api";
import { GlyphIcon, ICONS, ICON_SIZE, InfoPopover, Select, Switch, Textarea } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import type { TableDraft } from "./plugin-config-draft";

/**
 * Column widths, in the table's fixed layout. Equal for every choice column so none reads wider
 * than its siblings; sized together so the sandbox's presets fit the settings dialog at its
 * default width with the name column taking what is left.
 */
const WIDTH = {
  enum: "w-[5.75rem]",
  pin: "w-[3rem]",
  choice: "w-[4.75rem]",
  boolean: "w-[3.25rem]",
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

export function ConfigTable({
  entry,
  name,
  field,
  table,
  onCell,
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
  onCell: (row: string, column: string, value: string | boolean) => void;
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
  const rowChoice = field.rowChoice;
  // The columns in drawing order: the row choice slots in before the column it names.
  type Slot = { kind: "column"; column: PluginConfigTableColumn } | { kind: "choice" };
  const slots: Slot[] = [];
  for (const column of field.columns ?? []) {
    if (rowChoice !== undefined && rowChoice.before === column.name) slots.push({ kind: "choice" });
    slots.push({ kind: "column", column });
  }
  if (rowChoice !== undefined && !slots.some((s) => s.kind === "choice")) {
    slots.push({ kind: "choice" });
  }
  const widthOf = (slot: Slot) =>
    slot.kind === "choice"
      ? WIDTH.choice
      : slot.column.type === "enum"
        ? WIDTH.enum
        : slot.column.type === "boolean"
          ? slot.column.pin !== undefined
            ? WIDTH.pin
            : WIDTH.boolean
          : "";
  const rowName = (row: { id: string; values: Record<string, unknown>; valuesZh?: Record<string, string> }) =>
    localized(String(row.values.name ?? row.id), row.valuesZh?.name);
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
            {slots.map((slot, i) => (
              <col key={i} className={widthOf(slot)} />
            ))}
          </colgroup>
          <thead>
            <tr className="bg-surface-muted">
              {slots.map((slot) =>
                slot.kind === "choice" ? (
                  <th key="choice" scope="col" className={`${TH} text-center`}>
                    <HeaderTitle
                      title={localized(rowChoice!.title, rowChoice!.titleZh)}
                      info={described(rowChoice!)}
                    />
                  </th>
                ) : (
                  <th
                    key={slot.column.name}
                    scope="col"
                    className={`${TH} ${slot.column.type === "boolean" ? "text-center" : ""}`}
                  >
                    <HeaderTitle
                      title={localized(slot.column.title, slot.column.titleZh)}
                      info={described(slot.column)}
                    />
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {(field.rows ?? []).map((row) => (
              <tr
                key={row.id}
                className="border-t border-line-muted transition-colors duration-150 hover:bg-surface-muted/60"
              >
                {slots.map((slot) => {
                  if (slot.kind === "choice") {
                    const choiceTitle = localized(rowChoice!.title, rowChoice!.titleZh);
                    return (
                      <td key="choice" className="px-1 py-1.5 text-center align-middle">
                        {/* One radio group per table: exactly one row is the choice. */}
                        <input
                          type="radio"
                          name={`${entry.name}.${name}.${rowChoice!.field}`}
                          aria-label={`${rowName(row)} · ${choiceTitle}`}
                          checked={choice === row.id}
                          disabled={disabled}
                          onChange={() => onChoice?.(row.id)}
                          className="size-4 align-middle accent-accent disabled:cursor-not-allowed"
                        />
                      </td>
                    );
                  }
                  const c = slot.column;
                  const cell = table[row.id]?.[c.name];
                  const locked = row.locked?.includes(c.name) === true;
                  const declared = localized(
                    String(row.values[c.name] ?? ""),
                    row.valuesZh?.[c.name],
                  );
                  const columnTitle = localized(c.title, c.titleZh);
                  const cellLabel = `${rowName(row)} · ${columnTitle}`;
                  const optionTitle = (value: unknown) => {
                    const option = c.options?.find((o) => o.value === value);
                    return option !== undefined
                      ? localized(option.title, option.titleZh)
                      : String(value);
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
                    <td
                      key={c.name}
                      className={`px-1 py-1.5 align-middle ${c.type === "boolean" ? "text-center" : ""}`}
                    >
                      {locked ? (
                        // The value alone: what the row holds, with no control to suggest
                        // it could change. "Locked" is in the name and the tooltip.
                        <span
                          aria-label={`${cellLabel}: ${shown} (${S.settings.pluginCellLocked})`}
                          data-tooltip={S.settings.pluginCellLocked}
                          className="block truncate px-1.5 text-xs text-fg-muted"
                        >
                          <span aria-hidden>{shown}</span>
                        </span>
                      ) : c.type === "boolean" ? (
                        c.pin !== undefined ? (
                          <PinToggle
                            label={cellLabel}
                            pinned={cell === true}
                            tooltip={
                              cell === true
                                ? localized(c.pin.on, c.pin.onZh)
                                : localized(c.pin.off, c.pin.offZh)
                            }
                            disabled={disabled}
                            onChange={(on) => onCell(row.id, c.name, on)}
                          />
                        ) : (
                          <Switch
                            aria-label={cellLabel}
                            checked={cell === true}
                            disabled={disabled}
                            onChange={(on) => onCell(row.id, c.name, on)}
                          />
                        )
                      ) : c.type === "enum" ? (
                        <Select
                          size="sm"
                          aria-label={cellLabel}
                          // Fills its column: every choice column is the same width.
                          className="!gap-1 !px-1.5"
                          value={typeof cell === "string" ? cell : ""}
                          disabled={disabled}
                          onChange={(e) => onCell(row.id, c.name, e.target.value)}
                        >
                          {(c.options ?? []).map((option) => {
                            const off = entry.unavailable?.find(
                              (u) =>
                                u.field === name && u.column === c.name && u.value === option.value,
                            );
                            const title = localized(option.title, option.titleZh);
                            return (
                              <option
                                key={option.value}
                                value={option.value}
                                disabled={off !== undefined}
                              >
                                {off === undefined
                                  ? title
                                  : S.settings.pluginOptionUnavailable(
                                      title,
                                      localized(off.reason, off.reasonZh),
                                    )}
                              </option>
                            );
                          })}
                        </Select>
                      ) : (
                        <WrappingNameBox
                          label={cellLabel}
                          // The effective text: an empty override is the declared text, in the
                          // page's language. Typing it back, or clearing the box, restores it.
                          value={typeof cell === "string" && cell !== "" ? cell : declared}
                          disabled={disabled}
                          onChange={(value) =>
                            onCell(row.id, c.name, value === declared ? "" : value)
                          }
                        />
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {errors.map((text, i) => (
        <p key={i} className={`text-xs ${toneInk.danger}`}>
          {text}
        </p>
      ))}
    </div>
  );
}

/**
 * A pin toggle: the pin glyph, filled while pinned. A real button with `aria-pressed`, named
 * "<row> · <column>"; its tooltip says the state in words.
 */
function PinToggle({
  label,
  pinned,
  tooltip,
  disabled,
  onChange,
}: {
  label: string;
  pinned: boolean;
  tooltip: string;
  disabled: boolean;
  onChange: (pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pinned}
      data-tooltip={tooltip}
      disabled={disabled}
      onClick={() => onChange(!pinned)}
      className={`inline-flex size-7 items-center justify-center rounded-md align-middle transition-colors duration-150 hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 ${pinned ? "text-fg" : "text-fg-subtle"}`}
    >
      <GlyphIcon d={ICONS.pin} size={ICON_SIZE.iconButton} filled={pinned} />
    </button>
  );
}

/**
 * A one-line text value that wraps instead of clipping: a name longer than the column (a
 * "Workspace Write with Ask") reads whole on two lines, where an <input> could only cut it off.
 * The box grows to its content; Enter and pasted line breaks never put a newline in the value.
 * Borderless until pointed at or focused: the row reads as a table of names, and the box shows
 * itself when it is about to be edited.
 */
function WrappingNameBox({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [value]);
  return (
    <Textarea
      ref={ref}
      size="sm"
      rows={1}
      aria-label={label}
      value={value}
      disabled={disabled}
      autoComplete="off"
      spellCheck={false}
      className="!w-full resize-none overflow-hidden !px-2 !py-1 !leading-snug !border-transparent !bg-transparent hover:!border-line focus:!border-fg-muted"
      onKeyDown={(e) => {
        if (e.key === "Enter") e.preventDefault();
      }}
      onChange={(e) => onChange(e.target.value.replace(/[\r\n]+/g, " "))}
    />
  );
}
