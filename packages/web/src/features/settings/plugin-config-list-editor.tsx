/**
 * A list field's structured editor: one row per entry, each row an input box (a free-text
 * line) or a select (a choice from the field's declared `items.options`), with buttons to
 * add a row, move one up or down, and delete one. It edits the same draft a textarea did —
 * the lines joined with newlines — so the save, the validation and what the server stores
 * are exactly what they were: a string array, trimmed and de-duplicated there.
 */
import { Button, GlyphIcon, ICONS, Input, Select } from "@prismshadow/penguin-ui";
import { ICON_SIZE } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { Locale } from "../../state/locale";
import { localizedText } from "../../lib/skill-use";
import type { PluginConfigField } from "@prismshadow/penguin-server/api";

export function ConfigListEditor({
  field,
  value,
  error,
  disabled,
  locale,
  onChange,
}: {
  field: PluginConfigField;
  /** The draft as the card holds it: the entries joined with newlines. */
  value: unknown;
  error: string | undefined;
  disabled: boolean;
  locale: Locale;
  onChange: (value: unknown) => void;
}) {
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const hint = localized(field.hint, field.hintZh);
  const info = localized(field.description, field.descriptionZh);
  const disclosed = info !== undefined ? { info, infoLabel: localized(field.title, field.titleZh) ?? "" } : {};
  const options = field.items?.options;
  const lines = typeof value === "string" && value !== "" ? value.split("\n") : [];
  const set = (next: string[]) => onChange(next.join("\n"));
  const move = (index: number, delta: number) => {
    const next = [...lines];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    set(next);
  };
  const cap = field.maxItems ?? Infinity;
  const label = localized(field.title, field.titleZh) ?? "";
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">
        {label}
        {info !== undefined && (
          <span className="ml-2 cursor-help text-xs font-normal text-fg-muted" title={info}>
            ?
          </span>
        )}
      </div>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-x-1">
            {options === undefined ? (
              <Input
                size="sm"
                value={line}
                disabled={disabled}
                aria-label={`${label} ${index + 1}`}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = e.target.value;
                  set(next);
                }}
              />
            ) : (
              <Select
                size="sm"
                value={line}
                disabled={disabled}
                aria-label={`${label} ${index + 1}`}
                onChange={(e) => {
                  const next = [...lines];
                  next[index] = e.target.value;
                  set(next);
                }}
              >
                {options.map((option) => {
                  const title = localized(option.title, option.titleZh);
                  return (
                    <option key={option.value} value={option.value}>
                      {title ?? option.value}
                    </option>
                  );
                })}
              </Select>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || index === 0}
              aria-label={S.settings.pluginListMoveUp}
              onClick={() => move(index, -1)}
            >
              <GlyphIcon d={ICONS.chevronUp} size={ICON_SIZE.iconButton} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled || index === lines.length - 1}
              aria-label={S.settings.pluginListMoveDown}
              onClick={() => move(index, 1)}
            >
              <GlyphIcon d={ICONS.chevronDown} size={ICON_SIZE.iconButton} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={disabled}
              aria-label={S.settings.pluginListRemove}
              onClick={() => set(lines.filter((_, i) => i !== index))}
            >
              <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || lines.length >= cap}
          onClick={() => set([...lines, ""])}
        >
          <GlyphIcon d={ICONS.plus} size={ICON_SIZE.iconButton} />
          {S.settings.pluginListAdd}
        </Button>
        {(hint !== undefined || error !== undefined) && (
          <div className={`text-xs ${error !== undefined ? "text-red-600 dark:text-red-400" : "text-fg-muted"}`}>
            {error ?? hint}
          </div>
        )}
      </div>
    </div>
  );
}
