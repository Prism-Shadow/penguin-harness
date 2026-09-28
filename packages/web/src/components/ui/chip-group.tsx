/**
 * A row of pressable chips in the segmented look: a gray track, the chosen chip raised in
 * white. `Segmented`'s sibling for rows that wrap or carry counts, which its fixed columns
 * do not allow. One chip is pressed at a time.
 */
import type { ReactNode } from "react";

const TRACK = "inline-flex flex-wrap gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800";
const CHIP = "rounded px-2 py-1 text-xs transition-colors duration-150 disabled:opacity-50";
const ON = "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100";
const OFF = "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200";

export function ChipGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  disabled = false,
  className = "",
  chipClassName = "",
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: ReactNode; ariaLabel?: string }>;
  disabled?: boolean;
  className?: string;
  /** Extra classes on every chip, for content that needs its own layout (an icon and a label). */
  chipClassName?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`${TRACK} ${className}`}>
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            aria-label={option.ariaLabel}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`${CHIP} ${chipClassName} ${on ? ON : OFF}`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
