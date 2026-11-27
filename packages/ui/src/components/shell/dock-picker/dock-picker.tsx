/**
 * The dock's start page: the body of an open dock with no tabs, which a dock shows when it is
 * pulled open empty and when its last tab closes. It is a home screen of what the dock can open,
 * one launch tile per choice in the caller's order, in the middle of the dock and scrolled when
 * the dock is too short for it. The right dock and full screen stack each icon over its name;
 * the bottom band sets them side by side in rows, which keep the band's few lines of height for
 * the choices themselves.
 *
 * `reveal` marks the page as content swapped into a dock that was already on screen (its last tab
 * just closed), and the theme fades it in; a page the dock opens with arrives with the dock.
 */
import type { HTMLAttributes, Ref } from "react";
import { LaunchGrid, type LaunchGridItem } from "../launch-grid/launch-grid";

export type DockPickerChoice = Omit<LaunchGridItem, "testId">;

export interface DockPickerProps extends HTMLAttributes<HTMLDivElement> {
  choices: readonly DockPickerChoice[];
  /** The bottom band: rows instead of tiles. */
  horizontal: boolean;
  /** The list's accessible name. */
  label: string;
  /** Content swapped into a dock already on screen, which the theme fades in. */
  reveal?: boolean;
  ref?: Ref<HTMLDivElement>;
}

export function DockPicker({
  choices,
  horizontal,
  label,
  reveal = false,
  className = "",
  ref,
  ...rest
}: DockPickerProps) {
  return (
    <div
      ref={ref}
      data-testid="dock-picker"
      {...rest}
      className={`flex min-h-0 flex-1 overflow-y-auto ${className}`}
    >
      <div
        data-reveal={reveal || undefined}
        className={`m-auto w-full ${horizontal ? "px-4 py-4" : "px-3 py-6"}`}
      >
        <LaunchGrid
          label={label}
          layout={horizontal ? "row" : "tile"}
          items={choices.map((choice) => ({ ...choice, testId: `dock-pick-${choice.key}` }))}
        />
      </div>
    </div>
  );
}
