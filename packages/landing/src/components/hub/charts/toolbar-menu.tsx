/**
 * An icon button in the results toolbar that opens a small panel under it (the filters, the
 * columns). The button names itself to assistive technology and to the pointer (its hint), shows
 * a count when something in its panel is on, and the panel closes on a click outside or Esc.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SiteGlyph } from "@prismshadow/penguin-ui/site";
import type { SiteGlyphName } from "@prismshadow/penguin-ui/site";

export function ToolbarMenu({
  label,
  glyph,
  count = 0,
  children,
}: {
  label: string;
  glyph: SiteGlyphName;
  /** How many choices in the panel are on; 0 shows no badge. */
  count?: number;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const panel = useId();
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-8 w-8 items-center justify-center rounded-lg border transition-colors ${
          open || count > 0
            ? "border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-700 dark:bg-brand-950 dark:text-brand-200"
            : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400 dark:hover:border-gray-700 dark:hover:text-gray-100"
        }`}
      >
        <SiteGlyph name={glyph} className="h-4 w-4" />
        {count > 0 && (
          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-600 px-1 text-xs leading-none text-white tabular-nums dark:bg-brand-400 dark:text-gray-950">
            {count}
          </span>
        )}
      </button>
      <div
        id={panel}
        role="group"
        aria-label={label}
        hidden={!open}
        className="absolute right-0 z-30 mt-1.5 w-64 rounded-lg border border-gray-200 bg-white p-1.5 text-sm dark:border-gray-700 dark:bg-gray-900"
      >
        {children}
      </div>
    </div>
  );
}

/** One checkbox row inside a toolbar panel. */
export function MenuCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: () => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="shrink-0 accent-brand-600"
      />
      <span className="min-w-0 truncate">{children}</span>
    </label>
  );
}
