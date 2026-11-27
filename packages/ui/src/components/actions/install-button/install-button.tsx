/**
 * The one button a thing you can install wears wherever it is listed — its card in a catalogue,
 * its row in a list, the head of its page: a store's Get / Open button. At rest it names the next
 * action ("Install", "Open", "Update"). While the install runs it carries the install in place:
 * its words say the step ("Downloading 42%"), a staged bar runs along its bottom edge, and it
 * stays pressable, so a press brings back what the install is doing.
 *
 * Its box never moves between those states. Every label the caller says it may show (`sizes`) is
 * stacked invisibly under the one on show, so the button is as wide as the widest of them from
 * the first frame, and the bar is drawn over the bottom edge rather than under the words. While
 * the install runs the button takes the neutral box instead of the accent fill, so the accent bar
 * reads on it; a theme's radius clips the bar (`data-clip-surface`).
 *
 * Props only: the words, the bar and what a press does are the caller's.
 */
import type { ReactNode } from "react";
import { Button } from "../button/button";
import type { ButtonProps } from "../button/button";

export interface InstallButtonProps extends Omit<
  ButtonProps,
  "children" | "loading" | "loadingLabel" | "leading"
> {
  /** The words on show: the next action at rest, the step while the install runs. */
  label: string;
  /**
   * Every other label this button may show (the steps, the next action once it is done): the
   * button is as wide as the widest, so a change of state moves nothing beside it.
   */
  sizes?: readonly string[];
  /** The install is under way: the neutral box, `aria-busy`, and `progress` along the edge. */
  running?: boolean;
  /** The install's bar (a `StagedProgress` at `xs`), drawn along the bottom edge while running. */
  progress?: ReactNode;
}

export function InstallButton({
  label,
  sizes = [],
  running = false,
  progress,
  variant = "primary",
  size = "sm",
  className = "",
  ...rest
}: InstallButtonProps) {
  const others = sizes.filter((text) => text !== label);
  return (
    <Button
      {...rest}
      variant={running ? "secondary" : variant}
      size={size}
      aria-busy={running || undefined}
      data-clip-surface=""
      data-install-button={running ? "running" : "idle"}
      className={`relative overflow-hidden ${className}`}
    >
      <span className="grid">
        <span className="col-start-1 row-start-1">{label}</span>
        {others.map((text) => (
          <span key={text} aria-hidden className="invisible col-start-1 row-start-1">
            {text}
          </span>
        ))}
      </span>
      {running && progress != null && (
        // A hairline lane under the words: the bar's segments are drawn two px tall here, so the
        // words keep their place and their descenders clear it.
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-3 bottom-0.5 [&_[data-stage]]:h-0.5"
        >
          {progress}
        </span>
      )}
    </Button>
  );
}
