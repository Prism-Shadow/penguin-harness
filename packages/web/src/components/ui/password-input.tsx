/**
 * Password input: a password variant of Input with an embedded show/hide toggle
 * (eye icon button) on the right. The label/hint/error wrapper structure mirrors
 * Input — the toggle button must be positioned relative to the **input element
 * itself**; if label/hint were handed to the inner Input as well, the button would
 * get pulled into the positioning reference frame along with the hint text and
 * shift out of place. So error is only passed down as `invalid` (red border), and
 * the error text is rendered below the box by this component.
 */
import { useId, useState } from "react";
import { Input, type InputProps } from "./input";
import { Field } from "./field";
import { S } from "../../lib/strings";

/** Eye (click to show) and a crossed-out closed eye (click to hide). */
const EYE = "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z";
const EYE_OFF =
  "M3 3l18 18M10.6 5.1A11 11 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 3.9M6.6 6.6C4 8.3 2 12 2 12s3.6 7 10 7a10 10 0 0 0 4.8-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2";

export function PasswordInput({
  label,
  hint,
  error,
  invalid,
  required,
  size = "base",
  className,
  ...rest
}: Omit<InputProps, "type">) {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? S.auth.hidePassword : S.auth.showPassword;
  // The error text renders in THIS component's Field (see the header comment), so the
  // association is wired here too: the inner Input only gets `invalid` and points its
  // aria-describedby at the outer FieldError.
  const errorId = useId();
  return (
    <Field label={label} hint={hint} error={error} errorId={errorId} required={required}>
      <div className="relative">
        <Input
          {...rest}
          required={required}
          size={size}
          type={visible ? "text" : "password"}
          invalid={Boolean(error) || Boolean(invalid)}
          aria-describedby={error ? errorId : undefined}
          className={`${size === "sm" ? "pr-8" : "pr-10"} ${className ?? ""}`}
        />
        <button
          type="button"
          aria-label={toggleLabel}
          title={toggleLabel}
          // Skip in the tab order: Tab should move between fields, not land on the reveal toggle.
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className={`absolute inset-y-0 right-0 flex items-center justify-center text-gray-400 transition-colors duration-150 hover:text-gray-600 dark:hover:text-gray-300 ${
            size === "sm" ? "w-8" : "w-10"
          }`}
        >
          <svg
            width={size === "sm" ? 14 : 16}
            height={size === "sm" ? 14 : 16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d={visible ? EYE_OFF : EYE} />
          </svg>
        </button>
      </div>
    </Field>
  );
}
