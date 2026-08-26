/**
 * Messaging panel — the current conversation's messaging binding as a dock tab (Feishu is
 * the only channel today), sitting in the panel rail beside the subagents and Trace
 * panels. It renders the SAME shared binding editor as the session-row dialog (hook +
 * body, not a fork): credentials + Save, the enable/disable toggle acting on the stored
 * credentials, the live status line, both probes, the tutorial link, and Unbind behind a
 * confirmation. Unbound, the editor's intro text explains the binding and the empty form
 * is the offer to create one.
 *
 * Status polling is gated on `active` (the dock keeps hidden tabs mounted): a hidden tab
 * neither polls nor loses the form state it accumulated.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { Skeleton } from "../../components/ui/skeleton";
import { FeishuBindingBody, useFeishuBinding } from "../chat/feishu-binding-editor";

export function MessagingPanel({ sessionId, active }: { sessionId: string; active: boolean }) {
  const b = useFeishuBinding(sessionId, { poll: active });
  const [unbinding, setUnbinding] = useState(false);

  const confirmUnbind = async () => {
    if (await b.unbind()) setUnbinding(false);
  };

  return (
    <div className="h-full overflow-y-auto p-3">
      {b.form === null ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          <FeishuBindingBody b={b} />
          {/* The dialog places these in its footer; the panel keeps them under the form. */}
          <div className="flex items-center justify-end gap-2">
            {b.hasStored && (
              <Button
                variant="danger"
                size="sm"
                disabled={b.busy}
                onClick={() => setUnbinding(true)}
              >
                {S.feishu.unbind}
              </Button>
            )}
            <Button variant="primary" size="sm" disabled={b.busy} onClick={() => void b.save()}>
              {b.busy ? S.common.saving : S.common.save}
            </Button>
          </div>
        </div>
      )}

      <ConfirmModal
        open={unbinding}
        title={S.feishu.unbindConfirmTitle}
        busy={b.busy}
        onClose={() => setUnbinding(false)}
        onConfirm={() => void confirmUnbind()}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.feishu.unbindConfirmBody}</p>
      </ConfirmModal>
    </div>
  );
}
