/**
 * Text input component: optional label and hint/error text; rounded corners with
 * a hover border darken and brand focus-ring transition. Shares the control look
 * and the label/hint/error scaffolding with the other form controls via field.tsx.
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { Field, controlBase } from "./field";

// Adds width, placeholder and disabled styling on top of the shared control look; each of Input/Textarea appends its own font size and padding (see their size).
const baseClass =
  `w-full ${controlBase} ` +
  "placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:placeholder:text-gray-500";

/** Size tier: base (form default) / sm (compact contexts like filter bars, keeps the toolbar from growing taller). */
export type ControlSize = "base" | "sm";

export const sizeClass: Record<ControlSize, string> = {
  base: "px-3 py-2 text-base",
  sm: "px-2 py-1 text-xs",
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  error?: string;
  /**
   * Marks the field red without rendering error text: use this when the input has a
   * custom wrapper (prefix glyph, unit suffix, etc.) and the caller places the error
   * text outside that wrapper — otherwise the text would get pulled into the
   * absolutely-positioned reference frame and skew the prefix/suffix layout.
   */
  invalid?: boolean;
  size?: ControlSize;
}

/**
 * Error state: red border + light red background (a failed field is visible at a
 * glance; the error text sits below the box).
 * Forced with `!` — baseClass's border-gray-300 / bg-white are the same kind of
 * border/background utility classes, and which one wins depends on the order the
 * CSS was generated in, not the order of classes in the string (without `!important`
 * this would get overridden).
 */
const errorClass =
  "!border-red-400 !bg-red-50 hover:!border-red-500 focus:!border-red-500 focus:!ring-red-400/30 " +
  "dark:!border-red-800 dark:!bg-red-950/40 dark:hover:!border-red-700 dark:focus:!border-red-600";

export function Input({
  label,
  hint,
  error,
  invalid,
  size = "base",
  className,
  ...rest
}: InputProps) {
  const bad = Boolean(error) || Boolean(invalid);
  return (
    <Field label={label} hint={hint} error={error}>
      <input
        className={`${baseClass} ${sizeClass[size]} ${bad ? errorClass : ""} ${className ?? ""}`}
        aria-invalid={bad ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  /** Marks the field red without rendering error text (see Input.invalid). */
  invalid?: boolean;
  /** Monospace font (for editing Prompts/parameters). */
  mono?: boolean;
  /** Font size: base (default, matches body text) or sm (smaller, for editing long Prompts). */
  size?: "base" | "sm";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, invalid, mono, size = "base", className, ...rest },
  ref,
) {
  const bad = Boolean(error) || Boolean(invalid);
  return (
    <Field label={label} hint={hint} error={error}>
      <textarea
        ref={ref}
        className={`${baseClass} px-3 py-2 ${size === "sm" ? "text-xs leading-relaxed" : "text-base"} ${mono ? "font-mono" : ""} ${bad ? errorClass : ""} ${className ?? ""}`}
        aria-invalid={bad ? true : undefined}
        {...rest}
      />
    </Field>
  );
});
