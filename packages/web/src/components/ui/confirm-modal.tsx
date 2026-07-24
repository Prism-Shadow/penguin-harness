/**
 * Confirmation dialog: a Modal with a Cancel / Confirm footer, for destructive or
 * overwriting actions (delete, overwrite-on-update, save-to-file, …). `tone` picks
 * the look — danger (red) for deletions, primary for saves and other overwrites —
 * and renders a matching tinted icon badge beside the message, so every
 * confirmation in the app reads the same way at a glance. The message and any
 * details (e.g. a version list) go in children.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { S } from "../../lib/strings";

/** Tinted icon badge per tone: warning triangle on red for danger, pencil-on-gray for confirmations that overwrite/save. */
function ToneBadge({ tone }: { tone: "danger" | "primary" }) {
  const glyph =
    tone === "danger"
      ? // Triangle alert (lucide): outline + exclamation.
        "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3zM12 9v4m0 4h.01"
      : // Pencil-line (lucide): writing changes down.
        "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z";
  return (
    <span
      aria-hidden
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
        tone === "danger"
          ? "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400"
          : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
      }`}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={glyph} />
      </svg>
    </span>
  );
}

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
  /** Confirm button variant: danger for deletions, primary for saves and other overwrites. */
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
      <div className="flex items-start gap-3">
        <ToneBadge tone={tone} />
        <div className="min-w-0 flex-1 pt-1">{children}</div>
      </div>
    </Modal>
  );
}

/**
 * Shared confirm-before-save flow for the settings forms: `requestSave(run)` opens a
 * standard "save these changes?" dialog and Confirm executes `run`. The caller decides
 * beforehand whether there is anything to save (no changes → an info toast, not a
 * dialog). Render `element` once per surface.
 */
export function useSaveConfirm(): {
  requestSave: (run: () => void) => void;
  element: ReactNode;
} {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const element = (
    <ConfirmModal
      open={pending !== null}
      title={S.common.confirmSaveTitle}
      tone="primary"
      confirmLabel={S.common.save}
      onClose={() => setPending(null)}
      onConfirm={() => {
        pending?.();
        setPending(null);
      }}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300">{S.common.confirmSaveBody}</p>
    </ConfirmModal>
  );
  return { requestSave: (run: () => void) => setPending(() => run), element };
}
