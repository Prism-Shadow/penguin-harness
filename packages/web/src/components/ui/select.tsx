/**
 * Dropdown select component: **custom-drawn** (not the native browser select),
 * keeping the same API — parses `<option>` children and follows the
 * `value` / `onChange(e.target.value)` convention. The menu is rendered via
 * portal to body (fixed positioning, computed from the button's rect), so it
 * is never clipped by a Modal or scroll container; it closes on outside click,
 * Esc, or scroll. Styling matches Input.
 */
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { sizeClass } from "./input";
import type { ControlSize } from "./input";

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  hint?: string;
  /** Same size tier as Input: sm is for filter bars, keeps the toolbar from growing taller. */
  size?: ControlSize;
}

interface Opt {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

/** Parses the option list out of `<option>` children. */
function parseOptions(children: ReactNode): Opt[] {
  const out: Opt[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child) || child.type !== "option") return;
    const p = child.props as { value?: string | number; children?: ReactNode; disabled?: boolean };
    out.push({
      value: p.value !== undefined ? String(p.value) : "",
      label: p.children ?? "",
      ...(p.disabled ? { disabled: true } : {}),
    });
  });
  return out;
}

const CONTROL_CLASS =
  "flex w-full items-center gap-2 rounded-md border border-gray-300 bg-white text-left text-gray-900 " +
  "transition-[border-color,box-shadow] duration-200 hover:border-gray-400 " +
  "focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-600 " +
  "dark:focus:border-gray-400 dark:focus:ring-gray-500/30";

export function Select({
  label,
  hint,
  size = "base",
  className,
  children,
  value,
  onChange,
  disabled,
}: SelectProps) {
  const options = parseOptions(children);
  const current = String(value ?? "");
  const selected = options.find((o) => o.value === current);

  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(
    null,
  );

  const place = () => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 240 && r.top > below; // Not enough room below and more room above -> open upward
    setPos({ left: r.left, top: up ? r.top : r.bottom, width: r.width, up });
  };

  useLayoutEffect(() => {
    if (open) place();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-select-menu]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    // Page scroll closes the menu (a fixed-positioned menu doesn't scroll with the
    // page, so leaving it in place would misalign it). But **the menu's own internal
    // scroll** (when there are more options than max-h-60) doesn't count: a
    // capture-phase listener would catch that too, and closing on it would mean the
    // menu shuts the moment the user scrolls, so they can never reach options below.
    const onScroll = (e: Event) => {
      const t = e.target;
      if (t instanceof Element && t.closest("[data-select-menu]")) return;
      setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", onDocDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  const pick = (v: string) => {
    setOpen(false);
    // Synthesize a minimal event object, following the caller's onChange(e.target.value) convention.
    onChange?.({ target: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>);
    btnRef.current?.focus();
  };

  const control = (
    <>
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`${CONTROL_CLASS} ${sizeClass[size]} ${className ?? ""}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? options[0]?.label ?? ""}
        </span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          className="shrink-0 text-gray-400"
          aria-hidden
        >
          <path d="M3 4.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open &&
        pos &&
        createPortal(
          <ul
            data-select-menu
            role="listbox"
            className="anim-pop fixed z-[60] max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            style={{
              left: pos.left,
              width: pos.width,
              ...(pos.up ? { bottom: window.innerHeight - pos.top + 4 } : { top: pos.top + 4 }),
            }}
          >
            {options.map((o, i) => (
              <li key={`${o.value}-${i}`}>
                <button
                  type="button"
                  role="option"
                  aria-selected={o.value === current}
                  disabled={o.disabled}
                  onClick={() => pick(o.value)}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-sm transition-colors duration-150 disabled:opacity-50 ${
                    o.value === current
                      ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                      : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.value === current && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      className="shrink-0 text-gray-500 dark:text-gray-400"
                      aria-hidden
                    >
                      <path
                        d="M5 12l4 4L19 6"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );

  if (!label && !hint) return control;
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          {label}
        </span>
      )}
      {control}
      {hint && <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">{hint}</span>}
    </label>
  );
}
