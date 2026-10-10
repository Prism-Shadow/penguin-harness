/**
 * Messaging panel — the current conversation's messaging bindings as a dock tab, sitting
 * in the panel rail beside the subagents and Trace panels. It renders the SAME shared
 * channel-aware binding editor as the session-row dialog (hook + body, not a fork): the
 * channel selector switching between the two channels' forms (each independently
 * savable), then the connection controls — the enable/disable toggle (one enabled channel
 * per conversation) with the live status line, both probes, and the hint naming what gates
 * the switch — then the per-channel credential fields with the credential-source link at
 * the field corner and the models-style stored-secret row, and the collapsed FAQ folds
 * below the Save area. There is no unbind action — removing a credential is the secret
 * field's clear checkbox.
 *
 * Status polling is gated on `active` (the dock keeps hidden tabs mounted): a hidden tab
 * neither polls nor loses the form state it accumulated.
 *
 * Unsaved edits are registered with the shared guard under this conversation's own scope (apart
 * from the session-row dialog's), so every way of throwing them away asks first: the tab's ×,
 * the one gesture that unmounts this body, and a route change such as opening another
 * conversation. Hiding the dock takes nothing away and asks nothing.
 */
import { useEffect } from "react";
import { Button, Skeleton, guardLeave, useUnsavedChanges } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { setCloseGuard } from "../dock/close-guard";
import { tabKey } from "../dock/dock-state";
import {
  MessagingBindingBody,
  MessagingBindingHelp,
  useMessagingBinding,
} from "./messaging-binding-editor";

export function MessagingPanel({ sessionId, active }: { sessionId: string; active: boolean }) {
  const b = useMessagingBinding(sessionId, { poll: active });
  const scope = `messaging-panel:${sessionId}`;
  useUnsavedChanges(b.unsavedAny, { scope, discard: b.discard });
  const dirty = b.unsavedAny;
  useEffect(() => {
    if (!dirty) return;
    const key = tabKey({ kind: "panel", panel: "messaging" });
    setCloseGuard(key, () => guardLeave(() => {}, scope));
    return () => setCloseGuard(key, null);
  }, [dirty, scope]);

  return (
    <div className="h-full overflow-y-auto p-3">
      {b.form === null ? (
        <div className="space-y-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : (
        <div className="space-y-3">
          <MessagingBindingBody b={b} />
          {/* The dialog places Save in its footer; the panel keeps it under the form. */}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="primary"
              size="sm"
              disabled={b.busy || !b.dirty || !b.valid}
              onClick={() => void b.save()}
            >
              {b.busy ? S.common.saving : S.common.save}
            </Button>
          </div>
          {/* Below the save area: the collapsed setup/what/troubleshooting folds. */}
          <MessagingBindingHelp channel={b.form.channel} />
        </div>
      )}
    </div>
  );
}
