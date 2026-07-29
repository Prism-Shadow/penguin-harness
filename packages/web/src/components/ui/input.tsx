/**
 * Text input component: optional label and hint/error text; rounded corners with
 * a hover border darken and brand focus-ring transition. Shares the control look
 * and the label/hint/error scaffolding with the other form controls via field.tsx.
 */
import { forwardRef, useId } from "react";
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
 * glance; the error text sits below the box). Shared with Select/OptionMenu so a
 * failed dropdown reads exactly like a failed input.
 * Forced with `!` — baseClass's border-gray-300 / bg-white are the same kind of
 * border/background utility classes, and which one wins depends on the order the
 * CSS was generated in, not the order of classes in the string (without `!important`
 * this would get overridden).
 */
export const errorClass =
  "!border-red-400 !bg-red-50 hover:!border-red-500 focus:!border-red-500 focus:!ring-red-400/30 " +
  "dark:!border-red-800 dark:!bg-red-950/40 dark:hover:!border-red-700 dark:focus:!border-red-600";

/**
 * Autofill policy: a control opts OUT unless its caller declares a real credential role.
 * Almost every field in this app holds an API key, a model id, a URL, a directory or a
 * price, and the browser's saved-login heuristics kept dropping the account's username and
 * password into them (a dialog's fields are unowned — no <form> element — so the browser
 * groups them with everything else on the page and picks a "username" box on its own).
 * Only login.tsx and the password dialogs pass a role ("username" / "current-password" /
 * "new-password"), and those keep the browser's help.
 *
 * `autocomplete="off"` alone does NOT cover a password box: Chrome and Safari ignore it
 * there and offer the saved login anyway. An opted-out SECRET field therefore goes out as
 * `new-password` — the one value password managers read as "not the account password" —
 * and both cases carry the manager-extension opt-outs (1Password / LastPass / Bitwarden /
 * Dashlane), which read their own attributes rather than `autocomplete`.
 */
export function autofillProps(autoComplete: string | undefined, secret: boolean) {
  // A declared role (anything but the opt-out) is the caller's decision: pass it through untouched.
  if (autoComplete !== undefined && autoComplete !== "off") return { autoComplete };
  return {
    autoComplete: secret ? "new-password" : "off",
    "data-1p-ignore": "",
    "data-lpignore": "true",
    "data-bwignore": "",
    "data-form-type": "other",
  };
}

/**
 * The same opt-out as a spreadable constant, for the handful of raw `<input>`s that don't go
 * through Input (menu search boxes, the Workspace path editor): `{...noAutofill}`.
 */
export const noAutofill = autofillProps(undefined, false);

export function Input({
  label,
  hint,
  error,
  invalid,
  required,
  size = "base",
  className,
  autoComplete,
  ...rest
}: InputProps) {
  const bad = Boolean(error) || Boolean(invalid);
  const errorId = useId();
  // `required` drives the label's asterisk + aria-required only; the native `required`
  // attribute is intentionally not forwarded (the app validates on submit, so browser
  // validation bubbles would collide with the inline field errors).
  return (
    <Field label={label} hint={hint} error={error} errorId={errorId} required={required}>
      <input
        className={`${baseClass} ${sizeClass[size]} ${bad ? errorClass : ""} ${className ?? ""}`}
        aria-invalid={bad ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : undefined}
        // Secret while masked; PasswordInput's reveal toggle flips the type to text, and the
        // opt-out that matters was already read from the password state.
        {...autofillProps(autoComplete, rest.type === "password")}
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
  { label, hint, error, invalid, required, mono, size = "base", className, autoComplete, ...rest },
  ref,
) {
  const bad = Boolean(error) || Boolean(invalid);
  const errorId = useId();
  return (
    <Field label={label} hint={hint} error={error} errorId={errorId} required={required}>
      <textarea
        ref={ref}
        className={`${baseClass} px-3 py-2 ${size === "sm" ? "text-xs leading-relaxed" : "text-base"} ${mono ? "font-mono" : ""} ${bad ? errorClass : ""} ${className ?? ""}`}
        aria-invalid={bad ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : undefined}
        {...autofillProps(autoComplete, false)}
        {...rest}
      />
    </Field>
  );
});
