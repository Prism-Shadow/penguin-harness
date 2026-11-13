/**
 * The public sites' one-of-a-few switch: a hairline box of text segments, the current one filled.
 * As `tablist` it switches views of the same content (a leaderboard's table, Pareto and waffle,
 * a task's statement and rubric); as `radiogroup` it picks a setting (a list's order, a chart's
 * axis). Every segment keeps its size whichever is current — the fill changes, never the weight —
 * so neither the switch nor anything beside it moves when the choice does.
 */
import type { ReactNode } from "react";

export interface SiteSegment<T extends string> {
  id: T;
  label: ReactNode;
}

export function SiteSegmented<T extends string>({
  role,
  label,
  options,
  value,
  onChange,
  className = "",
}: {
  role: "tablist" | "radiogroup";
  /** Names the group to assistive technology. */
  label: string;
  options: readonly SiteSegment<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  const tabs = role === "tablist";
  return (
    <div role={role} aria-label={label} className={`site-segmented inline-flex ${className}`}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role={tabs ? "tab" : "radio"}
          {...(tabs
            ? { "aria-selected": option.id === value }
            : { "aria-checked": option.id === value })}
          onClick={() => onChange(option.id)}
          className="site-segment"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
