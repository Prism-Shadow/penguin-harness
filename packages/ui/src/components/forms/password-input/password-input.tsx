/**
 * Password input: a password variant of Input with an embedded show/hide toggle (an eye) on the
 * right. The label/hint/error wrapper mirrors Input's — the toggle must be positioned relative to
 * the **input element itself**; if label/hint were handed to the inner Input as well, the button
 * would be pulled into the positioning reference frame along with the hint text and shift out of
 * place. So the error only reaches the inner Input as `invalid` (the red line), and the error text
 * is rendered below the box by this component.
 */
import { useId, useState } from "react";
import { useUiStrings } from "../../../strings";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";
import { ICONS } from "../../icons/icons";
import { Field } from "../field/field";
import { Input } from "../input/input";
import type { InputProps } from "../input/input";

export interface PasswordInputProps extends Omit<InputProps, "type" | "affix"> {
  /**
   * The reveal toggle's accessible name (and tooltip) in each state. The interface's own words
   * when omitted, so a caller passes these only to say something more specific.
   */
  toggleLabels?: { show: string; hide: string };
}

export function PasswordInput({
  label,
  hint,
  info,
  infoLabel,
  error,
  invalid,
  required,
  size = "sm",
  className,
  id,
  toggleLabels,
  ...rest
}: PasswordInputProps) {
  const strings = useUiStrings();
  const [visible, setVisible] = useState(false);
  const labels = toggleLabels ?? { show: strings.showPassword, hide: strings.hidePassword };
  const toggleLabel = visible ? labels.hide : labels.show;
  // The error text renders in THIS component's Field (see the header comment), so the
  // association is wired here too: the inner Input only gets `invalid` and points its
  // aria-describedby at the outer FieldError.
  const errorId = useId();
  // Same reason as Input: an info field's label sits outside the wrapper and needs htmlFor.
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
      <div className="relative">
        <Input
          {...rest}
          id={info !== undefined ? controlId : id}
          required={required}
          size={size}
          type={visible ? "text" : "password"}
          invalid={Boolean(error) || Boolean(invalid)}
          aria-describedby={error ? errorId : undefined}
          className={`${size === "sm" ? "pr-8" : "pr-10"} ${className ?? ""}`}
        />
        <button
          type="button"
          // The name says what a press does and changes with the state, so no aria-pressed:
          // a pressed state beside a name that flips would announce the change twice.
          aria-label={toggleLabel}
          data-tooltip={toggleLabel}
          // Skip in the tab order: Tab should move between fields, not land on the reveal toggle.
          tabIndex={-1}
          onClick={() => setVisible((v) => !v)}
          className={`absolute inset-y-0 right-0 flex items-center justify-center text-fg-subtle transition-colors duration-150 hover:text-fg-muted ${
            size === "sm" ? "w-8" : "w-10"
          }`}
        >
          <GlyphIcon d={visible ? ICONS.eyeOff : ICONS.eye} size={size === "sm" ? 14 : 16} />
        </button>
      </div>
    </Field>
  );
}
