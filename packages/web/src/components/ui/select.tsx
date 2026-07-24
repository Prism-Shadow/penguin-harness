/**
 * Dropdown select component: **custom-drawn** (not the native browser select),
 * keeping the same API — parses `<option>` children and follows the
 * `value` / `onChange(e.target.value)` convention. The menu is rendered via
 * portal to body (fixed positioning from the shared usePortalPanel hook), so it
 * is never clipped by a Modal or scroll container; it closes on outside click,
 * Esc, scroll, or resize. Styling matches Input.
 */
import { Children, isValidElement, useState } from "react";
import type { ChangeEvent, ReactNode, SelectHTMLAttributes } from "react";
import { createPortal } from "react-dom";
import { sizeClass } from "./input";
import type { ControlSize } from "./input";
import { Field, controlBase, menuRowClass } from "./field";
import { CheckIcon, ChevronDown } from "./icons";
import { usePortalPanel } from "./use-portal-panel";

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

const CONTROL_CLASS = `flex w-full items-center gap-2 text-left ${controlBase} disabled:cursor-not-allowed disabled:opacity-60`;

/** Menu-row text follows the control's size tier, so the dropdown reads exactly like an Input of the same tier (review: dropdown text = input text). */
const menuTextClass: Record<ControlSize, string> = { base: "text-base", sm: "text-xs" };

export function Select({
  label,
  hint,
  required,
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

  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    // Row height is roughly 36px (px-3 py-1.5 + text) — only used to decide up vs down.
    estimatedHeight: options.length * 36 + 8,
  });

  const pick = (v: string) => {
    setOpen(false);
    // Synthesize a minimal event object, following the caller's onChange(e.target.value) convention.
    onChange?.({ target: { value: v } } as unknown as ChangeEvent<HTMLSelectElement>);
    triggerRef.current?.focus();
  };

  const control = (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required || undefined}
        onClick={() => setOpen((v) => !v)}
        className={`${CONTROL_CLASS} ${sizeClass[size]} ${className ?? ""}`}
      >
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? options[0]?.label ?? ""}
        </span>
        <ChevronDown className="text-gray-400" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            className="anim-pop fixed z-[60] max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
            style={{
              left: position.left,
              width: position.triggerWidth,
              top: position.topPx,
              bottom: position.bottomPx,
            }}
          >
            {options.map((o, i) => (
              <button
                key={`${o.value}-${i}`}
                type="button"
                role="option"
                aria-selected={o.value === current}
                disabled={o.disabled}
                onClick={() => pick(o.value)}
                className={`flex items-center ${menuRowClass} ${menuTextClass[size]} disabled:opacity-50 ${
                  o.value === current
                    ? "bg-gray-100 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.value === current && <CheckIcon className="text-gray-500 dark:text-gray-400" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );

  return (
    <Field label={label} hint={hint} required={required}>
      {control}
    </Field>
  );
}
