/**
 * Shared confirm-before-save flow for the agent settings forms: `requestSave(run)` opens a
 * standard "save these changes?" dialog and Confirm executes `run`. The caller decides beforehand
 * whether there is anything to save (no changes → an info toast, not a dialog). Render `element`
 * once per surface.
 */
import { useState } from "react";
import type { ReactNode } from "react";
import { ConfirmModal } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

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
      cancelLabel={S.common.cancel}
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
