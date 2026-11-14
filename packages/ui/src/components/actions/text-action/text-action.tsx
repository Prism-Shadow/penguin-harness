/**
 * A press that reads as text — Retry, Retry now, Stop retrying, Details, Go to Machines, Expand —
 * for an action that sits in a line of status words, where a boxed button would outweigh the line
 * it belongs to (the transcript's "[Aborted]: …" marker, a retry line, a load failure).
 *
 * The word in square brackets in the body ink, the transcript marker's own shape ("[重试]" beside
 * "[已中断]"), the word underlined on hover.
 *
 * It is a real button: the keyboard reaches it, the shared focus ring draws round it, and it is
 * named by its word alone (the brackets are hidden from a screen reader). It takes the size
 * and the face of the text around it — mono in a mono line — and keeps its words on one line. A
 * busy press spins before its word and takes no press; a disabled one fades.
 */
import type { ButtonHTMLAttributes } from "react";
import { useUiStrings } from "../../../strings";
import { Spinner } from "../../icons/spinner/spinner";

export interface TextActionProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** The press's request is in flight: it spins and takes no press. */
  busy?: boolean;
  /** What the spinner announces while busy; the interface's busy word when omitted. */
  busyLabel?: string;
}

export function TextAction({
  busy = false,
  busyLabel,
  disabled,
  className = "",
  children,
  ...rest
}: TextActionProps) {
  const strings = useUiStrings();
  return (
    <button
      type="button"
      // Named by its word alone, whatever the brackets and the spinner beside it.
      aria-label={typeof children === "string" ? children : undefined}
      {...rest}
      data-text-action=""
      aria-busy={busy || undefined}
      disabled={disabled === true || busy}
      className={`group/action inline-flex shrink-0 cursor-pointer items-baseline gap-1 whitespace-nowrap rounded-sm text-fg underline-offset-2 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {busy && (
        <span className="self-center">
          <Spinner size="xs" label={busyLabel ?? strings.loading} />
        </span>
      )}
      {/* One run of text, so the brackets hug the word; the word alone takes the underline, and
          only while this press is hovered — a named group, since the line it sits in may be a
          `group` of its own (a transcript row) that a plain `group-hover` would answer to. */}
      <span>
        <span aria-hidden="true">[</span>
        <span className="group-hover/action:underline group-disabled/action:no-underline">
          {children}
        </span>
        <span aria-hidden="true">]</span>
      </span>
    </button>
  );
}
