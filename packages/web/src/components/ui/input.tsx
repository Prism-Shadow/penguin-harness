/**
 * Text input component: optional label and hint/error text; rounded corners with
 * a hover border darken and brand focus-ring transition. Shares the control look
 * and the label/hint/error scaffolding with the other form controls via field.tsx.
 */
import { forwardRef, useId } from "react";
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Field, controlBase } from "./field";

// Adds width, placeholder and disabled styling on top of the shared control look; each of Input/Textarea appends its own font size and padding (see their size).
const baseClass =
  `w-full ${controlBase} ` +
  "placeholder:text-gray-400 disabled:cursor-not-allowed disabled:opacity-60 " +
  "dark:placeholder:text-gray-500";

/**
 * Size tier: sm is the form rung — dense forms, dialogs, filter bars, and what almost every
 * control in the app takes. base is a full standalone page (the login card), which is roomier
 * on purpose and asks for the tier by name.
 *
 * Every control in the family defaults to sm, so a forgotten `size` lands on the rung its
 * neighbours are already on. The old default was base, which put a forgotten prop at the roomiest
 * rung in the densest place it could appear — that is how four dialog fields ended up a tier above
 * the controls beside them. The default is a safety net, not a licence: call sites still name
 * their rung.
 */
export type ControlSize = "base" | "sm";

/**
 * Font size per tier, and the only place a control's font size is spelled: Select's menu rows,
 * OptionMenu's row titles and Textarea all read it, so moving a rung moves the whole family.
 * The rungs are relative (`--text-*` is in rem and theme.tsx sets the root size per font tier),
 * so a control must never be given a `text-[Npx]` — that freezes it against the user's setting.
 */
export const sizeTextClass: Record<ControlSize, string> = { base: "text-base", sm: "text-xs" };

const sizePadClass: Record<ControlSize, string> = { base: "px-3 py-2", sm: "px-2 py-1" };

export const sizeClass: Record<ControlSize, string> = {
  base: `${sizePadClass.base} ${sizeTextClass.base}`,
  sm: `${sizePadClass.sm} ${sizeTextClass.sm}`,
};

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
  label?: string;
  hint?: string;
  /**
   * Semantic explanation — what the field means, what it affects, when it takes effect —
   * disclosed by a "?" beside the label. A rule about the *shape* of the input ("one per line",
   * "leave empty for unlimited") belongs in `hint`, which stays on screen while the user types.
   */
  info?: ReactNode;
  /** Accessible name for that "?" (defaults to the generic "More info"). */
  infoLabel?: string;
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
  info,
  infoLabel,
  error,
  invalid,
  required,
  size = "sm",
  className,
  autoComplete,
  id,
  ...rest
}: InputProps) {
  const bad = Boolean(error) || Boolean(invalid);
  const errorId = useId();
  // The info layout moves the label out of the wrapping <label> and associates it by htmlFor
  // (see Field), so an info field needs the control to carry an id.
  const generatedId = useId();
  const controlId = id ?? generatedId;
  // `required` drives the label's asterisk + aria-required only; the native `required`
  // attribute is intentionally not forwarded (the app validates on submit, so browser
  // validation bubbles would collide with the inline field errors).
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      errorId={errorId}
      required={required}
      info={info}
      infoLabel={infoLabel}
      controlId={controlId}
    >
      <input
        id={info !== undefined ? controlId : id}
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
  /** Semantic explanation behind a "?" beside the label (see InputProps.info). */
  info?: ReactNode;
  /** Accessible name for that "?" (defaults to the generic "More info"). */
  infoLabel?: string;
  error?: string;
  /** Marks the field red without rendering error text (see Input.invalid). */
  invalid?: boolean;
  /** Monospace font (for editing Prompts/parameters). */
  mono?: boolean;
  /** Same size tier as Input (sizeTextClass); sm is the form rung, base a standalone page. */
  size?: ControlSize;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    label,
    hint,
    info,
    infoLabel,
    error,
    invalid,
    required,
    mono,
    size = "sm",
    className,
    autoComplete,
    id,
    ...rest
  },
  ref,
) {
  const bad = Boolean(error) || Boolean(invalid);
  const errorId = useId();
  const generatedId = useId();
  const controlId = id ?? generatedId;
  return (
    <Field
      label={label}
      hint={hint}
      error={error}
      errorId={errorId}
      required={required}
      info={info}
      infoLabel={infoLabel}
      controlId={controlId}
    >
      <textarea
        ref={ref}
        id={info !== undefined ? controlId : id}
        // Font size comes from the shared record; the padding deliberately does NOT follow
        // sizeClass — a multi-line box keeps the roomier px-3 py-2 at both tiers, because the
        // sm tier's py-1 is sized for one line of text and crowds a block of them. The extra
        // leading goes with that, and only at sm, where the lines are closest together.
        className={`${baseClass} px-3 py-2 ${sizeTextClass[size]} ${size === "sm" ? "leading-relaxed" : ""} ${mono ? "font-mono" : ""} ${bad ? errorClass : ""} ${className ?? ""}`}
        aria-invalid={bad ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={error ? errorId : undefined}
        {...autofillProps(autoComplete, false)}
        {...rest}
      />
    </Field>
  );
});
