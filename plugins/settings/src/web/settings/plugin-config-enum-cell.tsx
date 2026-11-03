/**
 * A table's choice cell without select chrome: the current option's full title as plain text,
 * wrapping when long. Pressing it opens a small menu of the options — the UI package's portaled
 * `Dropdown` with the `Menu` family's rows, like every other menu in the app — so no scrolling
 * ancestor clips it; an option this machine cannot honour stays listed, greyed out, with the
 * reason. Keyboard (the Dropdown's): opening focuses the first row, the arrow keys move, Enter
 * picks, Esc closes this menu only, not an enclosing dialog.
 */
import { useState } from "react";
import { Dropdown, Menu, MenuRadioItem } from "@prismshadow/penguin-ui";

export interface EnumCellOption {
  value: string;
  title: string;
  /** Why this machine cannot honour it; set, the option is listed but cannot be picked. */
  unavailable?: string;
}

export function EnumCell({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: EnumCellOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  const pick = (option: EnumCellOption) => {
    setOpen(false);
    if (option.value !== value) onChange(option.value);
  };
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass="w-56"
      portal={{ direction: "down", align: "left" }}
      button={
        <button
          type="button"
          aria-label={`${label}: ${current?.title ?? value}`}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen(!open)}
          // Plain text that wraps; the hover wash and the focus ring say it can be pressed.
          className="w-full rounded-md px-1.5 py-1 text-left text-xs leading-snug break-words text-fg transition-colors duration-150 hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {current?.title ?? value}
        </button>
      }
    >
      <Menu label={label} density="sm" className="py-1">
        {options.map((o) => (
          <MenuRadioItem
            key={o.value}
            label={o.title}
            checked={o.value === value}
            disabled={o.unavailable !== undefined}
            {...(o.unavailable !== undefined ? { description: o.unavailable } : {})}
            onSelect={() => pick(o)}
          />
        ))}
      </Menu>
    </Dropdown>
  );
}
