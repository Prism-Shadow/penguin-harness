/**
 * Shared field scaffolding: the label / hint / error text and the wrapping
 * <label>, plus the class strings for a control's "look" and a menu row. Every
 * form control (Input, Textarea, Select, OptionMenu, PasswordInput) and every
 * form that shows a field error builds on these, instead of the five-plus
 * near-identical copies that used to live in each control and call site.
 */
import type { ReactNode } from "react";
import { InfoPopover } from "./info-popover";

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

/**
 * The red "*" that marks a field as required, and the only place it is spelled. A field is
 * required when submitting without it is refused — never because its label sounds mandatory —
 * and an optional field carries no counterpart mark: the absence of the asterisk is what says
 * "optional", so no surface writes that word into a label or a placeholder.
 *
 * `aria-hidden` by default because beside a control the mark is decorative: Field, Input,
 * Textarea, Select and OptionMenu set `aria-required` from the same flag, which is what a screen
 * reader announces. Where nothing carries that flag — a read-only table of schema properties,
 * say — pass `label`, and the mark states itself instead of leaving the row unmarked.
 */
export function RequiredMark({ label }: { label?: string }) {
  if (label === undefined) {
    return (
      <span className="ml-0.5 text-red-500 dark:text-red-400" aria-hidden>
        *
      </span>
    );
  }
  return (
    <span className="ml-0.5 text-red-500 dark:text-red-400">
      <span aria-hidden>*</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * The field's title. Renders as a real `<label htmlFor>` when the caller supplies the control's
 * id, and as a plain span otherwise — the span form is for the `<label>`-wrapped layout below,
 * where a second label element would compete for the same control.
 */
export function FieldLabel({
  children,
  required,
  htmlFor,
  block = true,
}: {
  children: ReactNode;
  required?: boolean;
  htmlFor?: string;
  /** Own the line (the default). Off when the label shares a flex row with an info trigger. */
  block?: boolean;
}) {
  const className = `text-xs font-semibold text-gray-600 dark:text-gray-400${block ? " mb-1 block" : ""}`;
  const content = (
    <>
      {children}
      {required && <RequiredMark />}
    </>
  );
  return htmlFor !== undefined ? (
    <label htmlFor={htmlFor} className={className}>
      {content}
    </label>
  ) : (
    <span className={className}>{content}</span>
  );
}

export function FieldHint({ children }: { children: ReactNode }) {
  return <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">{children}</span>;
}

/**
 * Field-level error text: placed directly below the offending input (the input itself
 * is highlighted red via the control's error/invalid state). role="alert" announces the
 * message to assistive tech the moment it appears; `id` is the anchor the control's
 * aria-describedby points at, so AT users can also find *what* is wrong from the input.
 */
export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} role="alert" className="mt-1 block text-xs text-red-600 dark:text-red-400">
      {children}
    </span>
  );
}

/**
 * Standard vertical field layout: an optional bold label above the control, and
 * below it a red error if present, otherwise a gray hint. Renders the bare
 * control (no wrapper) when there's no label/hint/error, so a caller can drop it
 * into a toolbar or table cell unchanged.
 *
 * Two layouts, and which one applies is decided by `info`. Without it the whole field is
 * wrapped in a `<label>`, which associates the title with the control implicitly. With it the
 * title has to move out of that wrapper: an info trigger is a `<button>`, a `<button>` is a
 * labelable element, and the first labelable descendant is the one a wrapping `<label>` names —
 * so nesting the trigger would silently retarget the title from the input to the "?" button.
 * The info layout therefore drops the wrapper and associates the title by `htmlFor`, which is
 * why it needs `controlId`.
 */
export function Field({
  label,
  hint,
  error,
  errorId,
  required,
  info,
  infoLabel,
  controlId,
  children,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** id for the error text — the control passes the same id in aria-describedby. */
  errorId?: string;
  /**
   * Renders a red "*" after the label. An optional field passes nothing — no counterpart mark,
   * and no "optional" in the label. With no `label` there is nothing to hang the mark on, so the
   * flag only reaches the control as `aria-required`; a custom label row must then draw the mark
   * itself with `<FieldLabel required>`, and the two halves have to be kept in step by hand.
   */
  required?: boolean;
  /** Semantic explanation, disclosed by a "?" beside the label. Formatting rules belong in `hint`, which stays visible. */
  info?: ReactNode;
  /** Accessible name for that "?" — pass the field's own name when several sit close together. */
  infoLabel?: string;
  /** id of the control `info`'s label points at; required for `info` to render. */
  controlId?: string;
  children: ReactNode;
}) {
  if (!label && !hint && !error && !info) return <>{children}</>;
  const below = error ? (
    <FieldError id={errorId}>{error}</FieldError>
  ) : hint ? (
    <FieldHint>{hint}</FieldHint>
  ) : null;
  const hasLabel = label != null && label !== "";
  if (info != null && controlId !== undefined) {
    return (
      <div className="block">
        <span className="mb-1 flex items-center gap-1">
          {hasLabel && (
            <FieldLabel required={required} htmlFor={controlId} block={false}>
              {label}
            </FieldLabel>
          )}
          <InfoPopover {...(infoLabel !== undefined ? { label: infoLabel } : {})}>
            {info}
          </InfoPopover>
        </span>
        {children}
        {below}
      </div>
    );
  }
  return (
    <label className="block">
      {hasLabel && <FieldLabel required={required}>{label}</FieldLabel>}
      {children}
      {below}
    </label>
  );
}
