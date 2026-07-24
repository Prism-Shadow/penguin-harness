/**
 * Confirmation dialog: a Modal with a Cancel / Confirm footer, for destructive or
 * overwriting actions (delete, overwrite-on-update, …). `tone` picks the confirm
 * button variant — danger (red) for deletions, primary for other overwrites. The
 * message and any details (e.g. a version list) go in children.
 */
import type { ReactNode } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { S } from "../../lib/strings";

export function ConfirmModal({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel,
  tone = "danger",
  busy = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm: () => void;
  /** Confirm button text (defaults to the shared "Confirm"). */
  confirmLabel?: string;
  /** Confirm button variant: danger for deletions, primary for other overwrites. */
  tone?: "danger" | "primary";
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button variant={tone} disabled={busy} onClick={onConfirm}>
            {confirmLabel ?? S.common.confirm}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
