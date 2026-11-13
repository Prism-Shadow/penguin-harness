/**
 * A dialog that hands the person a report to share — what failed and where, for an issue or a
 * message to whoever can fix it: a line or two on what the report is for and what to check before
 * sending it, the report itself, and the presses that send it on (copy it, open the issue form).
 *
 * The report is shown exactly as it would be shared: read-only, in mono, its lines kept and long
 * tokens wrapped rather than widening the dialog, selectable as a whole. A long one scrolls in its
 * own box, under the words above it, and the box takes focus so the keyboard can scroll it too.
 * Whatever the caller would rather not share must already be out of it; this draws what it is
 * given.
 *
 * Built on `Modal`, so it is portaled, closes on Esc and on the scrim, keeps focus inside while
 * open and hands it back on close, and rises as a bottom sheet at phone width. Its width is set
 * in pixels, not rems: a report is read line by line, so its measure should not grow with the
 * person's text size until it no longer fits beside the page.
 *
 * Props only: the words, the report and what each press does are the caller's.
 */
import type { ReactNode } from "react";
import { Modal } from "../modal/modal";

export interface ReportDialogProps {
  open: boolean;
  onClose: () => void;
  /** The dialog's title ("Request failure details"). */
  title: string;
  /** Above the report: what it is for, and what to check before sharing it. */
  description?: ReactNode;
  /** The report as it would be shared. */
  report: string;
  /** The report block's accessible name ("Report"). */
  reportLabel: string;
  /** The foot's presses (copy, open the issue form), in order; the last one leads. */
  actions: ReactNode;
}

export function ReportDialog({
  open,
  onClose,
  title,
  description,
  report,
  reportLabel,
  actions,
}: ReportDialogProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      widthClass="sm:max-w-[640px]"
      footer={actions}
    >
      <div className="flex flex-col gap-3">
        {description !== undefined && (
          <div className="flex flex-col gap-1 text-sm text-fg-muted">{description}</div>
        )}
        <pre
          role="region"
          aria-label={reportLabel}
          // Focusable so the keyboard can scroll a report longer than its box.
          tabIndex={0}
          data-report=""
          className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-line bg-surface-muted px-3 py-2 font-mono text-xs leading-relaxed text-fg [overflow-wrap:anywhere]"
        >
          {report}
        </pre>
      </div>
    </Modal>
  );
}
