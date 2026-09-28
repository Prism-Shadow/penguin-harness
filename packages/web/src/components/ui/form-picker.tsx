/**
 * Form-style picker shell: a full-width trigger that looks exactly like an Input/Select
 * (controlBase + the shared size tier, sm by default — leading icon, truncating label, trailing
 * chevron) with a portaled dropdown hanging under its left edge. It is the single source of the
 * "form-variant" look shared by the model picker, the workspace picker and the schedule's
 * session picker, so the three read identically and none re-hand-rolls the trigger. The
 * workspace picker opens a modal rather than a dropdown, so it takes the trigger alone
 * (FormPickerButton).
 *
 * It owns only the trigger + Dropdown wiring; the menu body is the caller's `children`
 * (a searchable list, …), and open/close state stays with the caller (the pickers drive it
 * and close on pick).
 */
import type { ReactNode } from "react";
import { Dropdown } from "./dropdown";
import { ChevronDown } from "./icons";
import { controlBase } from "./field";
import { sizeClass } from "./input";
import type { ControlSize } from "./input";

/** The trigger's own props: everything but the dropdown wiring. */
export interface FormPickerButtonProps {
  open: boolean;
  onClick: () => void;
  /** Leading visual (provider logo / folder icon), sized by the caller; omitted when there's none. */
  leading?: ReactNode;
  /** The selected value's display, or a placeholder (pair with `muted`). */
  label: ReactNode;
  /** Extra classes on the label span (e.g. `font-mono` for a path value). */
  labelClassName?: string;
  /** Grays the label as a placeholder (nothing selected yet). */
  muted?: boolean;
  title: string;
  ariaLabel: string;
  ariaHaspopup?: "listbox" | "dialog";
  disabled?: boolean;
  /** Same size tier as Input/Select; sm is the form rung every picker sits at today. */
  size?: ControlSize;
}

/**
 * The form-variant trigger on its own, for a picker whose panel is not a dropdown — the
 * Workspace picker opens a modal from it — so that picker still looks exactly like the others.
 */
export function FormPickerButton({
  open,
  onClick,
  leading,
  label,
  labelClassName = "",
  muted = false,
  title,
  ariaLabel,
  ariaHaspopup = "listbox",
  disabled = false,
  size = "sm",
}: FormPickerButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={ariaLabel}
      aria-haspopup={ariaHaspopup}
      aria-expanded={open}
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2 text-left ${controlBase} ${sizeClass[size]} disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {leading}
      <span className={`min-w-0 flex-1 truncate ${muted ? "text-gray-400" : ""} ${labelClassName}`}>
        {label}
      </span>
      <ChevronDown className="text-gray-400" />
    </button>
  );
}

export function FormPicker({
  open,
  setOpen,
  menuClass,
  children,
  ...button
}: Omit<FormPickerButtonProps, "onClick"> & {
  setOpen: (open: boolean) => void;
  /** Width / origin classes for the dropdown panel (placement itself is measured from the trigger). */
  menuClass: string;
  /** The dropdown menu body. */
  children: ReactNode;
}) {
  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      menuClass={menuClass}
      portal={{ direction: "down", align: "left" }}
      button={<FormPickerButton open={open} onClick={() => setOpen(!open)} {...button} />}
    >
      {children}
    </Dropdown>
  );
}
