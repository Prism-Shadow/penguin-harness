/**
 * The impl branch's diff in a large dialog, opened from the impl section's `+N/−M`: the shell the
 * Settings dialog uses (a headerless, bare Modal with its own heading and close control and a
 * fixed height), with the diff view (proposal-diff.tsx) filling it. Closing it leaves the page
 * where it was: the dialog is portaled over it and the page underneath never moves. The view
 * mounts only while the dialog is open, so closing drops its request and its state.
 */
import type { ReactNode } from "react";
import { CloseButton, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { ProposalDiff } from "./proposal-diff";

/** The dialog's frame: the heading (with what it is of) and the close cross, then the body filling the rest. */
export function DiffDialogShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
        <h2 className="flex min-w-0 flex-1 items-baseline gap-2 text-base font-semibold">
          <span className="shrink-0">{title}</span>
          <span className="min-w-0 truncate font-mono text-xs font-normal text-gray-500 dark:text-gray-400">
            {subtitle}
          </span>
        </h2>
        <CloseButton onClose={onClose} label={S.common.close} />
      </div>
      <div className="min-h-0 flex-1 px-4 py-3 text-xs sm:px-6">{children}</div>
    </div>
  );
}

export function ProposalDiffDialog({
  open,
  number,
  subtitle,
  onClose,
}: {
  open: boolean;
  number: number;
  /** The branch pair, as the impl section names it. */
  subtitle: string;
  onClose: () => void;
}) {
  const title = S.company.proposals.implDiff.title;
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      headerless
      bare
      fullScreenOnPhone
      widthClass="sm:h-[min(56rem,90vh)] sm:max-w-6xl"
    >
      <DiffDialogShell title={title} subtitle={subtitle} onClose={onClose}>
        <ProposalDiff number={number} />
      </DiffDialogShell>
    </Modal>
  );
}
