/**
 * A flat icon button on a public page's toolbar that opens a small panel of choices under it (a
 * leaderboard's filters, its columns). It names itself to assistive technology and to the pointer,
 * shows a count while something in its panel is on, and opens through the shared `Dropdown`: a
 * portaled panel, closed by a click outside or Esc, keyboard-walkable.
 *
 * A toolbar whose controls differ by view keeps them all mounted and greys out the ones the view
 * does not use (`disabled`, with `hint` saying where it applies): the toolbar keeps one width, so
 * nothing on it moves when the view changes.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Dropdown } from "../overlays/dropdown/dropdown";

export function SiteMenuButton({
  label,
  icon,
  count = 0,
  disabled = false,
  hint,
  children,
}: {
  label: string;
  icon: ReactNode;
  /** How many choices in the panel are on; 0 shows no badge. */
  count?: number;
  /** Greyed out and closed; it stays in place. */
  disabled?: boolean;
  /** The pointer's hint while disabled (e.g. "Columns apply to the table"). */
  hint?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open && !disabled;
  return (
    <Dropdown
      open={shown}
      setOpen={setOpen}
      portal={{ direction: "down", align: "right" }}
      menuClass="site-ui site-ui-menu-panel"
      button={
        <button
          type="button"
          aria-label={label}
          title={disabled && hint ? hint : label}
          aria-haspopup="true"
          aria-expanded={shown}
          aria-disabled={disabled || undefined}
          data-active={count > 0 || undefined}
          onClick={() => {
            if (!disabled) setOpen(!open);
          }}
          className="site-toolbar-button relative"
        >
          {icon}
          {count > 0 && !disabled && (
            <span aria-hidden className="site-toolbar-count tabular-nums">
              {count}
            </span>
          )}
        </button>
      }
    >
      {children}
    </Dropdown>
  );
}

/** One checkbox row inside a menu button's panel. */
export function SiteMenuCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="site-menu-check flex min-w-0 cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={onChange} className="shrink-0" />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}
