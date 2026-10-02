/**
 * A settings group's `table` field (the Sandbox card's presets): a fixed set of rows, one value
 * per column, drawn as a compact table inside a rounded, hairline-bordered box that scrolls
 * sideways on a narrow screen rather than squeezing its cells.
 *
 * Each cell is drawn by its column's type: a `string` cell is a borderless inline text box whose
 * value is the effective text (an empty override shows the declared text, in the page's
 * language, and clearing the box or typing the declared text back restores it);
 * a `boolean` cell is a switch; an `enum` cell is a compact select, its options this machine
 * cannot honour greyed out with the reason. A cell the row locks is not a control at all: it is
 * the value's text with a lock mark beside it, since a disabled select would read as broken.
 * A table with a `rowChoice` gets one more column of radios, one row chosen — the sandbox's
 * Default preset — stored in the group's own enum field.
 * Every control is named "<row> · <column>" for a screen reader, the row's name in the page's
 * language.
 */
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import {
  GlyphIcon,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  Input,
  Select,
  Switch,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import type { TableDraft } from "./plugin-config-draft";

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
  const label = localized(field.title, field.titleZh);
  const hint =
    field.description !== undefined ? localized(field.description, field.descriptionZh) : undefined;
  const columns = field.columns ?? [];
  const rowChoice = field.rowChoice;
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      {hint !== undefined && <p className="text-xs text-fg-muted">{hint}</p>}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="bg-surface-muted">
              {columns.map((c) => (
                <th
                  key={c.name}
                  scope="col"
                  className="whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-fg-muted"
                >
                  {localized(c.title, c.titleZh)}
                </th>
              ))}
              {rowChoice !== undefined && (
                <th
                  scope="col"
                  className="whitespace-nowrap px-2 py-2 text-left text-xs font-medium text-fg-muted"
                >
                  {localized(rowChoice.title, rowChoice.titleZh)}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {(field.rows ?? []).map((row) => (
              <tr
                key={row.id}
                className="border-t border-line-muted transition-colors duration-150 hover:bg-surface-muted/60"
              >
                {columns.map((c) => {
                  const cell = table[row.id]?.[c.name];
                  const locked = row.locked?.includes(c.name) === true;
                  const declared = localized(String(row.values[c.name] ?? ""), row.valuesZh?.[c.name]);
                  const cellLabel = `${localized(String(row.values.name ?? row.id), row.valuesZh?.name)} · ${localized(c.title, c.titleZh)}`;
                  const optionTitle = (value: unknown) => {
                    const option = c.options?.find((o) => o.value === value);
                    return option !== undefined
                      ? localized(option.title, option.titleZh)
                      : String(value);
                  };
                  return (
                    <td key={c.name} className="whitespace-nowrap px-1 py-1 align-middle">
                      {locked ? (
                        <span
                          aria-label={`${cellLabel}: ${c.type === "boolean" ? String(cell) : optionTitle(cell)} (${S.settings.pluginCellLocked})`}
                          data-tooltip={S.settings.pluginCellLocked}
                          className={`inline-flex items-center px-1 text-xs text-fg-muted ${ICON_GAP.row}`}
                        >
                          <span aria-hidden>
                            {c.type === "enum"
                              ? optionTitle(cell)
                              : c.type === "string"
                                ? cell === ""
                                  ? localized(
                                      String(row.values[c.name] ?? ""),
                                      row.valuesZh?.[c.name],
                                    )
                                  : String(cell)
                                : cell === true
                                  ? S.settings.pluginCellOn
                                  : S.settings.pluginCellOff}
                          </span>
                          <GlyphIcon
                            d={ICONS.lock}
                            size={ICON_SIZE.inlineGlyph}
                            className="text-fg-subtle"
                          />
                        </span>
                      ) : c.type === "boolean" ? (
                        <Switch
                          aria-label={cellLabel}
                          checked={cell === true}
                          disabled={disabled}
                          onChange={(on) => onCell(row.id, c.name, on)}
                        />
                      ) : c.type === "enum" ? (
                        <Select
                          size="sm"
                          aria-label={cellLabel}
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
                        <Input
                          size="sm"
                          aria-label={cellLabel}
                          // The effective text: an empty override is the declared text, in the
                          // page's language. Typing it back, or clearing the box, restores it.
                          value={typeof cell === "string" && cell !== "" ? cell : declared}
                          disabled={disabled}
                          autoComplete="off"
                          // Borderless until pointed at or focused: the row reads as a table
                          // of names, and the box shows itself when it is about to be edited.
                          className="!w-32 !border-transparent !bg-transparent hover:!border-line focus:!border-fg-muted"
                          onChange={(e) =>
                            onCell(
                              row.id,
                              c.name,
                              e.target.value === declared ? "" : e.target.value,
                            )
                          }
                        />
                      )}
                    </td>
                  );
                })}
                {rowChoice !== undefined && (
                  <td className="px-2 py-1 align-middle">
                    {/* One radio group per table: exactly one row is the choice. */}
                    <input
                      type="radio"
                      name={`${entry.name}.${name}.${rowChoice.field}`}
                      aria-label={`${localized(String(row.values.name ?? row.id), row.valuesZh?.name)} · ${localized(rowChoice.title, rowChoice.titleZh)}`}
                      checked={choice === row.id}
                      disabled={disabled}
                      onChange={() => onChoice?.(row.id)}
                      className="size-4 accent-accent disabled:cursor-not-allowed"
                    />
                  </td>
                )}
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
