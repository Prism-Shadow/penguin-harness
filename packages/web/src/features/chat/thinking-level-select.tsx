/** The composer and settings share the same thinking-level menu and localized tier names. */
import { useState } from "react";
import { FormPicker, ICONS, MenuSelect, MenuSelectBody } from "@prismshadow/penguin-ui";
import type { MenuSelectOption } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { SELECTABLE_THINKING_LEVELS, thinkingLevelLabel } from "./thinking-level";

export function ThinkingLevelSelect({
  value,
  onChange,
  disabled,
  direction = "down",
  variant = "pill",
  storedLevel,
}: {
  /** The resolved level; null while its defaults are loading. */
  value: string | null;
  onChange: (level: string) => void;
  disabled: boolean;
  direction?: "down" | "up";
  variant?: "pill" | "form";
  /** A settings draft may return to its persisted legacy tier before saving. */
  storedLevel?: string;
}) {
  const [open, setOpen] = useState(false);
  const label =
    value === null ? "…" : (thinkingLevelLabel(S.chat.thinkingLevelNames, value) ?? "—");
  const levels: readonly string[] =
    storedLevel === "none" ? [...SELECTABLE_THINKING_LEVELS, "none"] : SELECTABLE_THINKING_LEVELS;
  const options: MenuSelectOption<string>[] = levels.map((level) => ({
    value: level,
    label: S.chat.thinkingLevelMenuName(S.chat.thinkingLevelNames[level] ?? level, level),
  }));
  if (variant === "form") {
    return (
      <FormPicker
        open={open}
        setOpen={setOpen}
        label={label}
        ariaLabel={S.chat.thinkingLevel}
        disabled={disabled || value === null}
        menuClass="w-max min-w-36"
      >
        <MenuSelectBody
          title={S.chat.thinkingLevel}
          options={options}
          value={value}
          onPick={(level) => {
            setOpen(false);
            onChange(level);
          }}
        />
      </FormPicker>
    );
  }
  return (
    <MenuSelect<string>
      trigger={{
        glyph: ICONS.sparkle,
        label,
        caret: true,
        ariaLabel: S.chat.thinkingLevel,
        tooltip: `${S.chat.thinkingLevel}：${label}`,
        disabled: disabled || value === null,
      }}
      title={S.chat.thinkingLevel}
      options={options}
      value={value}
      onChange={onChange}
      direction={direction}
      align="right"
    />
  );
}
