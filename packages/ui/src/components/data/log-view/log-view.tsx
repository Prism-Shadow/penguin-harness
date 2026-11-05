/**
 * A command's output: monospace lines in an inset well that scrolls on its own past its height,
 * wrapping long lines rather than scrolling sideways. The latest line of a job still running can
 * stand out in the body ink while the earlier ones stay muted.
 *
 * It is a `log` region, so a screen reader hears lines as they are appended, and it takes focus,
 * so a keyboard can scroll it.
 */
import type { HTMLAttributes } from "react";

export type LogViewHeight = "sm" | "md" | "lg";

const HEIGHT: Record<LogViewHeight, string> = {
  sm: "max-h-48",
  md: "max-h-64",
  lg: "max-h-72",
};

export interface LogViewProps extends Omit<HTMLAttributes<HTMLPreElement>, "children"> {
  lines: readonly string[];
  /** The last line in the body ink: the step a running job is on. */
  highlightLast?: boolean;
  /** How tall the well grows before it scrolls: 12, 16 or 18 rem. */
  maxHeight?: LogViewHeight;
  /** The region's accessible name: what the output is of. */
  label?: string;
}

export function LogView({
  lines,
  highlightLast = false,
  maxHeight = "md",
  label,
  className = "",
  ...rest
}: LogViewProps) {
  const last = highlightLast && lines.length > 0 ? lines[lines.length - 1] : undefined;
  const body = last === undefined ? lines : lines.slice(0, -1);
  return (
    <pre
      role="log"
      aria-label={label}
      tabIndex={0}
      {...rest}
      className={`${HEIGHT[maxHeight]} overflow-auto rounded-md bg-surface-inset p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap text-fg-muted [overflow-wrap:anywhere] ${className}`}
    >
      {body.join("\n")}
      {last !== undefined && (
        <>
          {body.length > 0 ? "\n" : ""}
          <span className="text-fg">{last}</span>
        </>
      )}
    </pre>
  );
}
