/**
 * Asks before an action that would throw away unsaved edits, through the app's own
 * ConfirmModal rather than the browser's dialog. `ask(then)` runs `then` at once when
 * nothing is unsaved.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { S } from "../../lib/strings";

export function useDiscardConfirm(dirty: () => boolean): {
  ask: (then: () => void, onCancel?: () => void) => void;
  modal: ReactNode;
} {
  const [open, setOpen] = useState(false);
  const pending = useRef<(() => void) | null>(null);
  const cancel = useRef<(() => void) | null>(null);
  const ask = useCallback(
    (then: () => void, onCancel?: () => void) => {
      if (!dirty()) return then();
      pending.current = then;
      cancel.current = onCancel ?? null;
      setOpen(true);
    },
    [dirty],
  );
  const close = () => {
    setOpen(false);
    cancel.current?.();
    pending.current = cancel.current = null;
  };
  const confirm = () => {
    setOpen(false);
    const then = pending.current;
    pending.current = cancel.current = null;
    then?.();
  };
  const modal = (
    <ConfirmModal
      open={open}
      title={S.activities.discardTitle}
      confirmLabel={S.activities.discardConfirm}
      onClose={close}
      onConfirm={confirm}
    >
      <p className="text-sm">{S.activities.discard}</p>
    </ConfirmModal>
  );
  return { ask, modal };
}
