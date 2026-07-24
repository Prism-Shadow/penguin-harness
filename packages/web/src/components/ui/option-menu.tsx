/**
 * Option menu (controlled): the trigger button shows a compact current value, and
 * clicking it expands a panel where each row has a title + description text + a
 * selected-state checkmark. Replaces select controls that show only an abbreviation
 * and rely on the native `title` hover tooltip for details (tooltips are poorly
 * discoverable — users have no idea they should hover before they've clicked once).
 *
 * The trigger button shares the sizeClass size tier with Input/Select, and the panel
 * row styling matches the Select menu (py-1.5, bold selected row + SVG checkmark),
 * keeping visuals consistent when mixed with existing form controls.
 *
 * The panel is mounted via createPortal to document.body and positioned with
 * `position: fixed` against viewport coordinates — it does not reuse the Dropdown
 * primitive's in-place absolute positioning. Reason: a Dropdown panel is a DOM
 * descendant of its trigger button, so if an ancestor in the chain has a container
 * like overflow-x-auto (e.g. this component used inside a tool table), the CSS spec
 * says that when one axis has non-visible overflow and the other is visible, the
 * visible axis gets forced to `auto` — making that ancestor clip vertically
 * overflowing descendants, and absolute positioning is not exempt. A portaled node
 * is outside that ancestor's DOM subtree, so it is fundamentally unaffected by its
 * overflow, without having to audit every call site's ancestor chain.
 * Positioning and close behavior live in use-portal-panel.ts.
 *
 * The panel uses z-[60] (above the modal overlay's z-50): a portaled node sits in
 * the root stacking context, and this component may also be used inside a Modal
 * form, where z-40 would get covered by the overlay.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { sizeClass } from "./input";
import type { ControlSize } from "./input";
import { Field, controlBase, menuRowClass } from "./field";
import { CheckIcon, ChevronDown } from "./icons";
import { usePortalPanel } from "./use-portal-panel";

export interface OptionMenuChoice<T extends string> {
  value: T;
  /** Compact text on the trigger button (e.g. "rw"). */
  triggerLabel: string;
  /** Panel row title (e.g. "Read & write"). */
  label: string;
  /** Panel row description text explaining when this option actually takes effect. */
  description: string;
}

const PANEL_WIDTH = 288; // w-72

/** Row-title text follows the control's size tier, so the dropdown reads exactly like an Input of the same tier (review: dropdown text = input text); descriptions stay text-xs secondary. */
const rowTextClass: Record<ControlSize, string> = { base: "text-base", sm: "text-xs" };
/** Descriptions keep one step below the row title at every tier, so the title/description hierarchy survives the sm tier's text-xs titles. */
const rowDescClass: Record<ControlSize, string> = { base: "text-xs", sm: "text-[11px]" };

export function OptionMenu<T extends string>({
  options,
  value,
  onChange,
  placeholder,
  mono,
  label,
  required,
  fullWidth,
  size = "base",
  "aria-label": ariaLabel,
}: {
  options: ReadonlyArray<OptionMenuChoice<T>>;
  /** null/undefined means unset/default: the trigger shows the placeholder and no panel row is selected. */
  value: T | null | undefined;
  onChange: (value: T) => void;
  /** Placeholder text on the trigger when value is empty. */
  placeholder?: string;
  /** Use a monospace font for the trigger text. */
  mono?: boolean;
  /** Field title above the control (same typography as Input); omit to render a bare trigger button (e.g. for table cell usage). */
  label?: string;
  /** Renders a red "*" after the label to mark the field as required. */
  required?: boolean;
  /** Stretch the trigger button to fill the container width, as a replacement for native Select in dense form areas. */
  fullWidth?: boolean;
  /** Same size tier as Input/Select (sizeClass), for pixel-perfect alignment when mixed together. */
  size?: ControlSize;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    // Row height is roughly 48px (title + description two lines + py-1.5) + panel top/bottom padding.
    estimatedHeight: options.length * 48 + 16,
    panelWidth: PANEL_WIDTH,
  });
  const current = value != null ? options.find((o) => o.value === value) : undefined;

  const control = (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required || undefined}
        onClick={() => setOpen((v) => !v)}
        className={
          `flex items-center gap-2 ${controlBase} ${sizeClass[size]}` +
          (fullWidth ? " w-full justify-between" : "")
        }
      >
        <span className={`min-w-0 truncate ${mono ? "font-mono" : ""}`}>
          {current?.triggerLabel ?? placeholder ?? "—"}
        </span>
        <ChevronDown className="text-gray-400" />
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="listbox"
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
              minWidth: position.triggerWidth,
            }}
            className="anim-pop z-[60] max-h-[70vh] w-72 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-900"
          >
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`block ${menuRowClass} hover:bg-gray-100 dark:hover:bg-gray-800 ${
                  opt.value === value ? "bg-gray-100 dark:bg-gray-800" : ""
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span
                    className={`${rowTextClass[size]} ${
                      opt.value === value
                        ? "font-medium text-gray-900 dark:text-gray-100"
                        : "text-gray-700 dark:text-gray-300"
                    }`}
                  >
                    {opt.label}
                  </span>
                  {opt.value === value && (
                    <CheckIcon className="text-gray-500 dark:text-gray-400" />
                  )}
                </span>
                <span
                  className={`mt-0.5 block ${rowDescClass[size]} text-gray-500 dark:text-gray-400`}
                >
                  {opt.description}
                </span>
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
  return (
    <Field label={label} required={required}>
      {control}
    </Field>
  );
}
