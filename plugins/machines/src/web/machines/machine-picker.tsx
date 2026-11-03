/**
 * The compact machine switch in a page header: a small secondary button naming the machine
 * in view, the same height and shape as the icon buttons beside it, over a plain list of
 * machine names. Used where a page shows one machine at a time (the Plugins page, the
 * Settings dialog's Plugins page).
 *
 * The panel is portaled: one of its hosts is a dialog whose scrolling body would clip an
 * in-place panel.
 */
import { useState } from "react";
import { Button, ChevronDown, Dropdown, MenuItem } from "@prismshadow/penguin-ui";

export interface MachineChoice {
  value: string;
  label: string;
}

export function MachinePicker({
  choices,
  value,
  onChange,
  "aria-label": ariaLabel,
}: {
  choices: readonly MachineChoice[];
  value: string;
  onChange: (value: string) => void;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const current = choices.find((c) => c.value === value);
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      className="flex"
      menuClass="w-56 max-w-[calc(100vw-2rem)] origin-top-right py-1"
      portal={{ direction: "down", align: "right" }}
      button={
        <Button
          size="sm"
          className="h-8 max-w-48 shrink-0"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`${ariaLabel}: ${current?.label ?? value}`}
          onClick={() => setOpen(!open)}
        >
          <span className="min-w-0 truncate">{current?.label ?? value}</span>
          <ChevronDown className="shrink-0 text-gray-400" />
        </Button>
      }
    >
      <ul role="listbox" aria-label={ariaLabel} className="max-h-72 overflow-y-auto">
        {choices.map((choice) => {
          const selected = choice.value === value;
          return (
            <li key={choice.value} role="option" aria-selected={selected}>
              <MenuItem
                label={choice.label}
                checked={selected}
                onSelect={() => {
                  setOpen(false);
                  if (!selected) onChange(choice.value);
                }}
              />
            </li>
          );
        })}
      </ul>
    </Dropdown>
  );
}
