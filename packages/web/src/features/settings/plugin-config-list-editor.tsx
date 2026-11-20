/**
 * A list field's structured editor: one row per entry, each row an input box (a free-text
 * line) or a select (a choice from the field's declared `items.options`), with compact row
 * buttons to move an entry up or down and to delete it, plus an Add button below.
 *
 * The draft holds the entries as a string array (empty rows included while being typed);
 * on save the server receives the trimmed, de-duplicated string array.
 */
import type { PluginConfigField } from "@prismshadow/penguin-server/api";
import {
  Button,
  FieldError,
  FieldHint,
  FieldLabel,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  InfoPopover,
  Input,
  Select,
} from "@prismshadow/penguin-ui";
import { localizedText } from "../../lib/skill-use";
import { S } from "../../lib/strings";
import type { Locale } from "../../state/locale";
import { ICON_BUTTON } from "./plugin-config-table-cells";

/** Reads the draft as the list of lines on screen: a string array, or a newline-joined string. */
export function listLinesOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  if (typeof value === "string" && value !== "") return value.split("\n");
  return [];
}

export function ConfigListEditor({
  field,
  value,
  error,
  disabled,
  locale,
  onChange,
}: {
  field: PluginConfigField;
  /** The draft as the card holds it: a string array of entries on screen. */
  value: unknown;
  error: string | undefined;
  disabled: boolean;
  locale: Locale;
  onChange: (value: unknown) => void;
}) {
  const localized = (en: string | undefined, zh: string | undefined) =>
    en === undefined ? undefined : localizedText(locale, en, zh);
  const label = localized(field.title, field.titleZh) ?? "";
  const info = localized(field.description, field.descriptionZh);
  const hint = localized(field.hint, field.hintZh);
  const options = field.items?.options;
  const lines = listLinesOf(value);
  const set = (next: string[]) => onChange(next);
  const move = (index: number, delta: number) => {
    const next = [...lines];
    const [row] = next.splice(index, 1);
    next.splice(index + delta, 0, row!);
    set(next);
  };
  const add = () => {
    if (options !== undefined) {
      const nextChoice =
        options.find((o) => !lines.includes(o.value))?.value ?? options[0]?.value ?? "";
      set([...lines, nextChoice]);
      return;
    }
    set([...lines, ""]);
  };
  const cap = field.maxItems ?? Infinity;
  return (
    <div className="block">
      <span className="mb-1 flex items-center gap-1">
        {label !== "" && (
          <FieldLabel
            {...(field.required !== undefined ? { required: field.required } : {})}
            block={false}
          >
            {label}
          </FieldLabel>
        )}
        {info !== undefined && <InfoPopover label={label}>{info}</InfoPopover>}
      </span>
      <div className="space-y-2">
        {lines.map((line, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <div className="min-w-0 flex-1">
              {options === undefined ? (
                <Input
                  size="sm"
                  value={line}
                  placeholder={field.placeholder ?? ""}
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
                    const taken = lines.some((l, i) => i !== index && l === option.value);
                    return (
                      <option key={option.value} value={option.value} disabled={taken}>
                        {title ?? option.value}
                      </option>
                    );
                  })}
                </Select>
              )}
            </div>
            {lines.length > 1 && (
              <>
                <button
                  type="button"
                  disabled={disabled || index === 0}
                  aria-label={S.settings.pluginListMoveUp}
                  data-tooltip={S.settings.pluginListMoveUp}
                  onClick={() => move(index, -1)}
                  className={`${ICON_BUTTON} shrink-0`}
                >
                  <GlyphIcon d={ICONS.chevronUp} size={ICON_SIZE.iconButton} />
                </button>
                <button
                  type="button"
                  disabled={disabled || index === lines.length - 1}
                  aria-label={S.settings.pluginListMoveDown}
                  data-tooltip={S.settings.pluginListMoveDown}
                  onClick={() => move(index, 1)}
                  className={`${ICON_BUTTON} shrink-0`}
                >
                  <GlyphIcon d={ICONS.chevronDown} size={ICON_SIZE.iconButton} />
                </button>
              </>
            )}
            <button
              type="button"
              disabled={disabled}
              aria-label={S.settings.pluginListRemove}
              data-tooltip={S.settings.pluginListRemove}
              onClick={() => set(lines.filter((_, i) => i !== index))}
              className={`${ICON_BUTTON} shrink-0`}
            >
              <GlyphIcon d={ICONS.trash} size={ICON_SIZE.iconButton} />
            </button>
          </div>
        ))}
        <div>
          <Button
            size="sm"
            variant="secondary"
            disabled={disabled || lines.length >= cap}
            onClick={add}
          >
            <GlyphIcon d={ICONS.plus} size={ICON_SIZE.inlineGlyph} />
            {S.settings.pluginListAdd}
          </Button>
        </div>
      </div>
      {error !== undefined ? (
        <FieldError>{error}</FieldError>
      ) : hint !== undefined ? (
        <FieldHint>{hint}</FieldHint>
      ) : null}
    </div>
  );
}
