/**
 * Text controls: `Input` and `Textarea`, with an optional label and hint/error text, on the
 * shared control look (field.tsx). An `Input` may draw a short affix inside its box — a currency
 * symbol before the value, a unit after it — and reserves exactly the room the affix takes.
 */
import { forwardRef, useCallback, useId, useState } from "react";
import type {
  CSSProperties,
  InputHTMLAttributes,
  ReactNode,
  RefCallback,
  TextareaHTMLAttributes,
} from "react";
import { Field, controlBase } from "../field/field";

// Adds width, placeholder and disabled styling on top of the shared control look; each of
// Input/Textarea appends its own font size and padding (see their size).
const baseClass =
  `w-full ${controlBase} ` +
  "placeholder:text-fg-subtle disabled:cursor-not-allowed disabled:opacity-60";

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
 * The rungs are relative (`--text-*` follows the theme's type scale and the root size the user's
 * font-size setting picks), so a control must never be given a `text-[Npx]` — that freezes it
 * against the user's setting.
 */
export const sizeTextClass: Record<ControlSize, string> = { base: "text-base", sm: "text-xs" };

const sizePadClass: Record<ControlSize, string> = { base: "px-3 py-2", sm: "px-2 py-1" };

export const sizeClass: Record<ControlSize, string> = {
  base: `${sizePadClass.base} ${sizeTextClass.base}`,
  sm: `${sizePadClass.sm} ${sizeTextClass.sm}`,
};

/**
 * Error state: the danger line around the box, held on hover and focus, with a danger focus ring
 * (the error text sits below the box). Shared with Select/OptionMenu so a failed dropdown reads
 * exactly like a failed input. The box keeps its surface fill: a tinted fill inside a line of the
 * same hue is the one-hue box the design refuses, and the line alone is the signal.
 *
 * Forced with `!` — the control look's own line and ring are the same kind of utility, and which
 * one wins depends on the order the CSS was generated in, not the order of classes in the string.
 */
export const errorClass = "!border-tone-danger-fg focus:!ring-2 focus:!ring-tone-danger-fg/30";

/**
 * Autofill policy: a control opts OUT unless its caller declares a real credential role.
 * Almost every field in this app holds an API key, a model id, a URL, a directory or a
 * price, and the browser's saved-login heuristics kept dropping the account's username and
 * password into them (a dialog's fields are unowned — no <form> element — so the browser
 * groups them with everything else on the page and picks a "username" box on its own).
 * Only the login page and the password dialogs pass a role ("username" / "current-password" /
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
 * through Input (the Workspace path editor, inline number editors): `{...noAutofill}`.
 */
export const noAutofill = autofillProps(undefined, false);

/**
 * Live width of one affix drawn inside an input, so the input can reserve exactly the room it
 * occupies. An affix is rendered text: its width follows the resolved font, the root font size
 * (the appearance setting scales it) and whatever the caller puts in it (a currency symbol that
 * follows a setting), none of which is known where the padding is written — which is why it is
 * measured rather than typed. The affix is absolutely positioned, so its size does not depend on
 * the padding derived from it.
 *
 * Returns a callback ref for the affix element and its measured width (0 until measured).
 */
export function useAffixWidth(): [RefCallback<HTMLElement>, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((el: HTMLElement | null) => {
    if (el === null) return;
    // The observer reports the box LAYOUT size, which is what has to be reserved. A rect read
    // off the element would be wrong here: a dialog pops in under a scale transform, so a
    // measurement taken while that animation runs comes back short, and a transform never
    // notifies an observer that would correct it. Delivery is after layout and before paint,
    // so the unmeasured state is not painted; a font, language or font-size change resizes the
    // affix and re-runs this.
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.borderBoxSize[0]?.inlineSize ?? entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Padding that clears an affix of the given rendered width: the 0.5rem the affix is inset from the
 * input edge (`left-2` / `right-2`), the affix itself, and 0.25rem of separation so the value does
 * not read as one run of text with it. An unmeasured width (0) still yields a padding no smaller
 * than the control's own, so nothing lands outside the box.
 */
function affixPadding(width: number): string {
  return `calc(${width}px + 0.75rem)`;
}

/** Muted text pinned inside the box, clear of the pointer so a click still lands in the field. */
const affixClass = "pointer-events-none absolute inset-y-0 flex items-center text-fg-subtle";

/** Short text drawn inside an Input's box, before or after the value. */
export interface InputAffix {
  /** Before the value — a currency symbol. */
  leading?: ReactNode;
  /** After the value — a unit. */
  trailing?: ReactNode;
}

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
   * Marks the field red without rendering error text: use this when the input has a custom
   * wrapper (a trailing menu button, say) and the caller places the error text outside that
   * wrapper — otherwise the text would get pulled into the absolutely-positioned reference frame
   * and skew the layout. An `affix` needs none of this: the Input keeps its error below the box.
   */
  invalid?: boolean;
  size?: ControlSize;
  /** Text drawn inside the box before and/or after the value; the value's padding clears it. */
  affix?: InputAffix;
}

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
  title,
  affix,
  style,
  ...rest
}: InputProps) {
  const bad = Boolean(error) || Boolean(invalid);
  const errorId = useId();
  // The info layout moves the label out of the wrapping <label> and associates it by htmlFor
  // (see Field), so an info field needs the control to carry an id.
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const [leadingRef, leadingWidth] = useAffixWidth();
  const [trailingRef, trailingWidth] = useAffixWidth();
  const leading = affix?.leading;
  const trailing = affix?.trailing;
  const affixStyle: CSSProperties = {
    ...(leading != null ? { paddingLeft: affixPadding(leadingWidth) } : {}),
    ...(trailing != null ? { paddingRight: affixPadding(trailingWidth) } : {}),
  };
  // `required` drives the label's asterisk + aria-required only; the native `required`
  // attribute is intentionally not forwarded (the app validates on submit, so browser
  // validation bubbles would collide with the inline field errors).
  const control = (
    <input
      id={info !== undefined ? controlId : id}
      className={`${baseClass} ${sizeClass[size]} ${bad ? errorClass : ""} ${className ?? ""}`}
      style={affix === undefined ? style : { ...style, ...affixStyle }}
      aria-invalid={bad ? true : undefined}
      aria-required={required || undefined}
      aria-describedby={error ? errorId : undefined}
      // Secret while masked; PasswordInput's reveal toggle flips the type to text, and the
      // opt-out that matters was already read from the password state.
      {...autofillProps(autoComplete, rest.type === "password")}
      // A hover hint shows in the shared tooltip, never the browser's own `title`.
      data-tooltip={title}
      {...rest}
    />
  );
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
      {affix === undefined ? (
        control
      ) : (
        <span className="relative block">
          {leading != null && (
            <span ref={leadingRef} className={`${affixClass} left-2 ${sizeTextClass[size]}`}>
              {leading}
            </span>
          )}
          {control}
          {trailing != null && (
            <span ref={trailingRef} className={`${affixClass} right-2 ${sizeTextClass[size]}`}>
              {trailing}
            </span>
          )}
        </span>
      )}
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
    title,
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
        data-tooltip={title}
        {...rest}
      />
    </Field>
  );
});
