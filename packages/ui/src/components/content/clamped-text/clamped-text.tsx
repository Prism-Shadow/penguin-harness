/**
 * Text that may run long — a provider's error, a raw message — kept in sight rather than hidden
 * behind a "?": clamped to a few lines, with an Expand text action after it only when it really
 * runs past them, and Collapse once it is open.
 *
 * Measured before paint and again whenever its box resizes, so the toggle never arrives a frame
 * late and the line under it never moves after the first paint. An unbroken token (a URL, a JSON
 * blob) wraps anywhere rather than widening the line. The words are the caller's, and so is the
 * ink and the face.
 *
 * Its two parts join whatever row holds it (the wrapper draws no box of its own): in a wrapping
 * row with presses after it (a notice's Retry), text that runs long takes the row's width and
 * Expand lands on the next line beside those presses, while short text keeps them on its line.
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useUiStrings } from "../../../strings";
import { TextAction } from "../../actions/text-action/text-action";

export type ClampLines = 2 | 3 | 4;

const CLAMP: Readonly<Record<ClampLines, string>> = {
  2: "line-clamp-2",
  3: "line-clamp-3",
  4: "line-clamp-4",
};

export function ClampedText({
  children,
  lines = 3,
  className = "",
}: {
  /** The text, and any inline parts it carries (a label, a muted detail). */
  children: ReactNode;
  /** How many lines show before Expand. */
  lines?: ClampLines;
  /** The text's ink; the clamp is the component's. */
  className?: string;
}) {
  const strings = useUiStrings();
  const text = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [runsLong, setRunsLong] = useState(false);
  useLayoutEffect(() => {
    const el = text.current;
    if (el === null || open) return;
    const measure = () => setRunsLong(el.scrollHeight > el.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children, lines, open]);
  return (
    <span className="contents">
      <span
        ref={text}
        className={`min-w-0 [overflow-wrap:anywhere] ${open ? "block" : CLAMP[lines]} ${className}`}
      >
        {children}
      </span>
      {(runsLong || open) && (
        <TextAction aria-expanded={open} onClick={() => setOpen((was) => !was)}>
          {open ? strings.collapse : strings.expand}
        </TextAction>
      )}
    </span>
  );
}
