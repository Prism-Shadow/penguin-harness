/**
 * Shared field scaffolding: the label / hint / error text and the wrapping
 * <label>, plus the class strings for a control's "look" and a menu row. Every
 * form control (Input, Textarea, Select, OptionMenu, PasswordInput) and every
 * form that shows a field error builds on these, instead of the five-plus
 * near-identical copies that used to live in each control and call site.
 */
import type { ReactNode } from "react";

/**
 * The control "look" shared by Input, Select and OptionMenu: rounded box, gray
 * border that darkens on hover, brand focus ring, dark-mode variants. Excludes
 * layout (width/flex), text size, placeholder and disabled styling — each
 * control appends what it needs.
 */
export const controlBase =
  "rounded-md border border-gray-300 bg-white text-gray-900 " +
  "transition-[border-color,box-shadow] duration-200 " +
  "hover:border-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 " +
  "dark:hover:border-gray-600 dark:focus:border-gray-400 dark:focus:ring-gray-500/30";

/** Base padding/alignment/transition for a menu row (Select, OptionMenu, and the chat composer menus); callers add flex/block and the hover/selected colors. */
export const menuRowClass = "w-full px-3 py-1.5 text-left transition-colors duration-150";

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
      {children}
    </span>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">{children}</span>;
}

/** Field-level error text: placed directly below the offending input (the input itself is highlighted red via the control's error/invalid state). */
export function FieldError({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{children}</span>;
}

/**
 * Standard vertical field layout: an optional bold label above the control, and
 * below it a red error if present, otherwise a gray hint. Renders the bare
 * control (no wrapper) when there's no label/hint/error, so a caller can drop it
 * into a toolbar or table cell unchanged.
 */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  if (!label && !hint && !error) return <>{children}</>;
  return (
    <label className="block">
      {label != null && label !== "" && <FieldLabel>{label}</FieldLabel>}
      {children}
      {error ? <FieldError>{error}</FieldError> : hint ? <FieldHint>{hint}</FieldHint> : null}
    </label>
  );
}
