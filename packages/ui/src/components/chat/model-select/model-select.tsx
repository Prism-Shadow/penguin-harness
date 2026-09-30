/**
 * The model picker's trigger: the control a model is chosen from, showing the chosen model's
 * provider logo and name. What it opens is the caller's — a dialog (the app's model picker, with
 * its search and provider rail) — and the trigger only reports whether that is open. Two shapes:
 *
 * - `pill`: the composer's toolbar pill (`ToolbarTrigger`: logo, name, caret; the name hides on a
 *   narrow card, leaving the logo, and the tooltip still names the model);
 * - `form`: a dialog's form field (the shared `FormPickerTrigger`, full width, Input-styled).
 *
 * Every word is the caller's: the name it shows, its accessible name and its tooltip.
 */
import { FormPickerTrigger } from "../../forms/select/form-picker";
import { ProviderLogo } from "../../icons/logos/provider-logo";
import { ToolbarTrigger } from "../composer/toolbar-trigger";

export interface ModelSelectProps {
  /** The trigger's words: the chosen model's name, or what stands in for none. */
  label: string;
  /** The trigger's logo; null draws none (no provider is being named). */
  provider: string | null;
  /** The form field's words read as a placeholder. */
  muted?: boolean;
  /** The trigger's accessible name. */
  ariaLabel: string;
  /** The trigger's tooltip: the name with the model in it. */
  tooltip: string;
  disabled?: boolean;
  /** The composer's toolbar pill, or a dialog's form field. */
  variant?: "pill" | "form";
  /** Whether the dialog it opens is open. */
  expanded: boolean;
  onClick: () => void;
}

export function ModelSelect({
  label,
  provider,
  muted = false,
  ariaLabel,
  tooltip,
  disabled = false,
  variant = "pill",
  expanded,
  onClick,
}: ModelSelectProps) {
  const logo =
    provider === null ? null : <ProviderLogo provider={provider} className="h-4 w-4 shrink-0" />;
  if (variant === "form") {
    return (
      <FormPickerTrigger
        size="sm"
        expanded={expanded}
        onClick={onClick}
        leading={logo}
        label={label}
        muted={muted}
        title={tooltip}
        ariaLabel={ariaLabel}
        ariaHaspopup="dialog"
        disabled={disabled}
      />
    );
  }
  return (
    <ToolbarTrigger
      glyph={logo}
      label={label}
      caret
      width="md"
      ariaLabel={ariaLabel}
      tooltip={tooltip}
      ariaHaspopup="dialog"
      disabled={disabled}
      expanded={expanded}
      onClick={onClick}
    />
  );
}
