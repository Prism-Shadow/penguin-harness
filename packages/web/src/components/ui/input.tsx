/**
 * Text input component: optional label and hint/error text; rounded corners with
 * a hover border darken and brand focus-ring transition.
 */
import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";

// Excludes font size and padding: each of Input/Textarea appends its own (see their size).
const baseClass =
  "w-full rounded-md border border-gray-300 bg-white text-gray-900 " +
  "placeholder:text-gray-400 transition-[border-color,box-shadow] duration-200 " +
  "hover:border-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-400/30 " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder:text-gray-500 " +
  "dark:hover:border-gray-600 dark:focus:border-gray-400 dark:focus:ring-gray-500/30";

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
  const control = (
    <input
      className={`${baseClass} ${sizeClass[size]} ${bad ? errorClass : ""} ${className ?? ""}`}
      aria-invalid={bad ? true : undefined}
      {...rest}
    />
  );
  if (!label && !hint && !error) return control;
  return (
    <label className="block">
      {label && (
        <span className="mb-1 block text-xs font-semibold text-gray-600 dark:text-gray-400">
          {label}
        </span>
      )}
      {control}
      {error ? (
        <span className="mt-1 block text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-gray-500 dark:text-gray-500">{hint}</span>
      ) : null}
    </label>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  /** Monospace font (for editing Prompts/parameters). */
  mono?: boolean;
  /** Font size: base (default, matches body text) or sm (smaller, for editing long Prompts). */
  size?: "base" | "sm";
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, mono, size = "base", className, ...rest },
  ref,
) {
  const control = (
    <textarea
      ref={ref}
      className={`${baseClass} px-3 py-2 ${size === "sm" ? "text-xs leading-relaxed" : "text-base"} ${mono ? "font-mono" : ""} ${className ?? ""}`}
      {...rest}
    />
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
});
