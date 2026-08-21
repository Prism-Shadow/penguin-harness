/**
 * The shared "collapsible one-liner" shell: a full-width row — status icon, label, optional
 * trailing detail, chevron — that expands to a caller-styled body. Extracted verbatim from
 * the thinking block so every disclosure row in the transcript (thinking, the background
 * completion notice) shares one source of truth for width, padding, both color states and
 * the chevron interaction, and cannot drift apart. The tool cards keep their own richer row
 * structure but reference the same class constants below.
 */
import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { Chevron } from "../../components/ui/chevron";

/**
 * The row itself (collapsed and expanded state share it; the hover tone is the "open or
 * close me" affordance). Byte-identical to the class the thinking block and tool-card rows
 * carried before the extraction.
 */
export const DISCLOSURE_ROW_CLASS =
  "flex w-full items-center gap-2 bg-white px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:bg-gray-900 dark:hover:bg-gray-800";

/**
 * Stacked-sticky positioning for rows living inside the work group: while a row's expanded
 * body scrolls, the row pins right below the stuck group header (top-4 = the header's -top-4
 * offset + its 2rem height). Standalone rows (a single-row card) omit it.
 */
export const DISCLOSURE_ROW_STICKY_CLASS = "sticky top-4 z-[4]";

/** The row's text label (the thinking block's exact label styling). */
export const DISCLOSURE_LABEL_CLASS = "shrink-0 text-xs text-gray-500 dark:text-gray-400";

/**
 * Expanded plain-text body, the tool cards' output styling (an exec_command's expanded
 * output): a bordered mono <pre> block. Referenced by tool-call-card and every disclosure
 * body that shows raw output.
 */
export const DISCLOSURE_OUTPUT_PRE_CLASS =
  "max-h-72 overflow-auto whitespace-pre-wrap border-t border-gray-100 px-3 py-2 text-xs leading-5 text-gray-600 dark:border-gray-800 dark:text-gray-300";

/**
 * The card container a row (or group of rows) sits in — the work group's exact chrome.
 * A standalone disclosure row wraps itself in one so its width and framing match the
 * neighboring groups.
 */
export const DISCLOSURE_CARD_CLASS =
  "anim-msg my-2 overflow-clip rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900";

export function DisclosureRow({
  icon,
  label,
  trailing,
  sticky = false,
  defaultOpen = false,
  children,
}: {
  /** Leading status icon slot (a StatusIcon, matching the thinking/tool rows). */
  icon: ReactNode;
  /** The row's one-line label (rendered in DISCLOSURE_LABEL_CLASS). */
  label: string;
  /** Optional detail between the label and the spacer (duration, a failure tag). */
  trailing?: ReactNode;
  /** Rows inside the work group pin under its stuck header; standalone rows don't. */
  sticky?: boolean;
  defaultOpen?: boolean;
  /** Expanded body; the caller styles it (md body, output <pre>, …). */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef}>
      <button
        type="button"
        onClick={() => {
          // Collapsing while the row is stuck: its real top sits above the fold — land the
          // view back on the row (nearest = no movement for expanding / in-view collapse).
          const willClose = open;
          setOpen((v) => !v);
          if (willClose) {
            requestAnimationFrame(() => rootRef.current?.scrollIntoView({ block: "nearest" }));
          }
        }}
        aria-expanded={open}
        className={`${sticky ? `${DISCLOSURE_ROW_STICKY_CLASS} ` : ""}${DISCLOSURE_ROW_CLASS}`}
      >
        {icon}
        <span className={DISCLOSURE_LABEL_CLASS}>{label}</span>
        {trailing}
        <span className="min-w-0 flex-1" />
        <Chevron open={open} className="text-gray-400" />
      </button>
      {open && children}
    </div>
  );
}
