/**
 * Segmented control (for 2- to 5-way choices like theme/language/messaging channel): small
 * grayscale style. Shared by the sidebar user menu, the login page and the binding editor.
 *
 * An option may carry a `badge`: a mini tag pinned at the top-right of its label, for a mark that
 * qualifies the choice itself rather than reporting a state — company mode's 内测版 tag on the
 * work-mode switch. It is positioned out of flow, so neither an option's height nor the control's
 * overall size moves when one appears, and it is hidden from the accessible name; the badge's
 * `name` is what the option's name gains instead, as ` · <name>`.
 */
import type { ReactNode } from "react";

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: ReadonlyArray<{
    value: T;
    label: string;
    badge?: { node: ReactNode; name: string };
  }>;
  value: T;
  onChange: (v: T) => void;
  cols?: 2 | 3 | 4 | 5;
}) {
  return (
    <div
      // Spelled out rather than interpolated: Tailwind scans for whole class names, and a
      // `grid-cols-${n}` built at runtime is never emitted into the stylesheet.
      className={`grid ${cols === 2 ? "grid-cols-2" : cols === 4 ? "grid-cols-4" : cols === 5 ? "grid-cols-5" : "grid-cols-3"} gap-0.5 rounded-md bg-gray-100 p-0.5 dark:bg-gray-800`}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          // An aria-label replaces every descendant in the accessible name, so it is only set
          // where there is a badge to fold in — otherwise the label's own text is the name.
          aria-label={opt.badge ? `${opt.label} · ${opt.badge.name}` : undefined}
          className={`rounded px-1 py-1 text-xs transition-colors duration-150 ${
            value === opt.value
              ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100"
              : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          }`}
        >
          {opt.badge ? (
            <span className="relative inline-block">
              {opt.label}
              {/* `left-full` rather than a negative right offset: the tag hangs off the label's
                  right edge whatever it is wide, and never overlaps the word. */}
              <span aria-hidden className="absolute -top-1.5 left-full">
                {opt.badge.node}
              </span>
            </span>
          ) : (
            opt.label
          )}
        </button>
      ))}
    </div>
  );
}
