/**
 * One field of a settings group, drawn from its declared type: a text box, a password box with
 * the stored value's mask and a clear box, a switch, a number box, a select (its options this
 * machine cannot honour greyed out with the reason), a list of lines, or a table
 * (plugin-config-table.tsx). It shows the draft it is handed and reports each edit; the page
 * owns the drafts, the errors and what a change sets in motion.
 */
import type { PluginConfigEntry, PluginConfigField } from "@prismshadow/penguin-server/api";
import {
  Checkbox,
  Input,
  PasswordInput,
  Select,
  Textarea,
  ToggleRow,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Locale } from "../../state/locale";
import { localizedText } from "../chat/skill-use";
import { ConfigTable } from "./plugin-config-table";
import type { TableDraft } from "./plugin-config-draft";

export function ConfigField({
  entry,
  name,
  field,
  value,
  error,
  tableErrors,
  choice,
  onChoice,
  clearing,
  onChange,
  onClearingChange,
  disabled,
  locale,
}: {
  entry: PluginConfigEntry;
  name: string;
  field: PluginConfigField;
  /** The field's draft: a string as typed, a boolean, a list as its lines, a table's cells. */
  value: unknown;
  error: string | undefined;
  /** A table's refused cells, each named `<field>.<row>.<column>` by the server. */
  tableErrors: string[];
  /** A table's single-choice column: the chosen row as drafted, and its setter. */
  choice?: unknown;
  onChoice?: (row: string) => void;
  /** A secret field: whether the next save drops the stored value. */
  clearing: boolean;
  onChange: (value: unknown) => void;
  onClearingChange: (on: boolean) => void;
  disabled: boolean;
  locale: Locale;
}) {
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const label = localized(field.title, field.titleZh) ?? name;
  // What the field means sits behind a "?" beside its title; the shape a value must take (the
  // hint) stays on screen, since it is read while typing.
  const info = localized(field.description, field.descriptionZh);
  const hint = localized(field.hint, field.hintZh);
  const disclosed = info !== undefined ? { info, infoLabel: label } : {};
  switch (field.type) {
    case "table": {
      const table = (value ?? {}) as TableDraft;
      return (
        <ConfigTable
          key={name}
          entry={entry}
          name={name}
          field={field}
          table={table}
          onCell={(row, column, value) =>
            onChange({ ...table, [row]: { ...table[row], [column]: value } })
          }
          errors={tableErrors}
          choice={choice}
          {...(onChoice !== undefined ? { onChoice } : {})}
          disabled={disabled}
          locale={locale}
        />
      );
    }
    case "enum":
      return (
        <Select
          key={name}
          size="sm"
          label={label}
          {...(hint !== undefined ? { hint } : {})}
          {...disclosed}
          {...(error !== undefined ? { error } : {})}
          value={typeof value === "string" ? (value as string) : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((option) => {
            // An option this machine cannot honour stays listed, greyed out, with the reason.
            const off = entry.unavailable?.find(
              (u) => u.field === name && u.value === option.value,
            );
            const title = localized(option.title, option.titleZh);
            return (
              <option key={option.value} value={option.value} disabled={off !== undefined}>
                {off === undefined
                  ? title
                  : S.settings.pluginOptionUnavailable(
                      title ?? option.value,
                      localized(off.reason, off.reasonZh) ?? off.reason,
                    )}
              </option>
            );
          })}
        </Select>
      );
    case "list":
      return (
        <Textarea
          key={name}
          label={label}
          rows={3}
          {...(hint !== undefined ? { hint } : {})}
          {...disclosed}
          {...(error !== undefined ? { error } : {})}
          value={typeof value === "string" ? (value as string) : ""}
          placeholder={field.placeholder ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "boolean":
      return (
        <ToggleRow
          key={name}
          variant="plain"
          label={label}
          {...(hint !== undefined ? { hint } : {})}
          {...(info !== undefined ? { info } : {})}
          checked={value === true}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "secret": {
      const masked = typeof entry.values[name] === "string" ? (entry.values[name] as string) : "";
      const typed = typeof value === "string" ? (value as string) : "";
      return (
        <div key={name} className="space-y-1">
          <PasswordInput
            size="sm"
            label={label}
            {...(hint !== undefined ? { hint } : {})}
            {...disclosed}
          {...disclosed}
            {...(error !== undefined ? { error } : {})}
            value={typed}
            placeholder={
              masked !== "" ? S.settings.pluginSecretKeepHint : (field.placeholder ?? "")
            }
            disabled={disabled}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
          />
          {masked !== "" && typed === "" && (
            <div className="flex items-center gap-x-3 text-xs text-fg-muted">
              <span className="font-mono">{masked}</span>
              <Checkbox
                checked={clearing}
                disabled={disabled}
                label={S.settings.pluginSecretClear}
                onChange={onClearingChange}
              />
            </div>
          )}
        </div>
      );
    }
    case "number":
      return (
        <Input
          key={name}
          size="sm"
          type="number"
          label={label}
          {...(hint !== undefined ? { hint } : {})}
          {...disclosed}
          {...(error !== undefined ? { error } : {})}
          value={typeof value === "string" ? (value as string) : ""}
          placeholder={field.placeholder ?? ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return (
        <Input
          key={name}
          size="sm"
          label={label}
          {...(hint !== undefined ? { hint } : {})}
          {...disclosed}
          {...(error !== undefined ? { error } : {})}
          value={typeof value === "string" ? (value as string) : ""}
          placeholder={field.placeholder ?? ""}
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
