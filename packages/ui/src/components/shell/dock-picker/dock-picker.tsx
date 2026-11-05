/**
 * The body of an open dock that has no tabs yet: a centred list of what can open there, one row
 * per choice — a glyph and a name, and the key caps of a shortcut that does the same thing.
 * The bottom surface lays its choices out in a wrapping row; the right one stacks them.
 */
import type { HTMLAttributes, ReactNode } from "react";
import { ICON_GAP } from "../../../icon-scale";
import { Kbd } from "../../actions/kbd/kbd";

export interface DockPickerChoice {
  /** Stable id: the row's test id is `dock-pick-<key>`. */
  key: string;
  label: string;
  glyph: ReactNode;
  /** A shortcut that makes the same choice, as the platform names its keys (`["Ctrl", "`"]`). */
  keys?: readonly string[];
  onChoose: () => void;
}

export interface DockPickerProps extends HTMLAttributes<HTMLDivElement> {
  choices: readonly DockPickerChoice[];
  /** A row of choices (the bottom surface) instead of a list (the right one). */
  horizontal: boolean;
}

export function DockPicker({ choices, horizontal, className = "", ...rest }: DockPickerProps) {
  return (
    <div
      data-testid="dock-picker"
      {...rest}
      className={`flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4 ${className}`}
    >
      <div
        className={
          horizontal
            ? "flex max-w-full flex-wrap items-center justify-center gap-1"
            : "flex w-60 flex-col gap-1"
        }
      >
        {choices.map((choice) => (
          <button
            key={choice.key}
            type="button"
            data-testid={`dock-pick-${choice.key}`}
            onClick={choice.onChoose}
            className={`flex items-center ${ICON_GAP.menu} rounded-md px-3 py-2 text-left text-sm text-fg-muted transition-colors duration-150 hover:bg-line-muted hover:text-fg`}
          >
            <span className="shrink-0 text-fg-muted">{choice.glyph}</span>
            <span className={`min-w-0 truncate ${choice.keys === undefined ? "" : "flex-1"}`}>
              {choice.label}
            </span>
            {choice.keys !== undefined && <Kbd keys={choice.keys} />}
          </button>
        ))}
      </div>
    </div>
  );
}
