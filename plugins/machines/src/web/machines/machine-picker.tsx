/**
 * The machine switch where a page or a section shows one machine at a time (the Plugins page's
 * header, the Settings dialog's Plugins page): the shared UI package's `Select`, so it takes the
 * control size scale like the search box and the selects beside it — one height, padding,
 * radius, type rung and chevron for a given `size` — rather than a button of its own. The panel
 * is portaled by `Select`, so a dialog's scrolling body does not clip it.
 *
 * The trigger names the field (`aria-label`); the selected option's text says which machine is
 * in view.
 */
import { Select } from "@prismshadow/penguin-ui";
import type { ControlSize } from "@prismshadow/penguin-ui";

export interface MachineChoice {
  value: string;
  label: string;
}

export function MachinePicker({
  choices,
  value,
  onChange,
  size = "sm",
  className = "max-w-48 shrink-0",
  "aria-label": ariaLabel,
}: {
  choices: readonly MachineChoice[];
  value: string;
  onChange: (value: string) => void;
  /** The control rung of the controls beside it; the filter-bar `sm` by default. */
  size?: ControlSize;
  /**
   * The box the select fills: by default as wide as the machine's name (up to 12rem), so it
   * takes no more of a header row than its choice needs.
   */
  className?: string;
  "aria-label": string;
}) {
  return (
    <div className={className}>
      <Select
        size={size}
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => {
          if (event.target.value !== value) onChange(event.target.value);
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
