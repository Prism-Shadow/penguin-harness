/**
 * Approval buttons: appear on the
 * corresponding tool card when always-ask is set and there's a pending approval; the decision
 * is submitted via POST /api/sessions/:s/approvals/:toolCallId.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";

export function ApprovalButtons({
  onDecide,
}: {
  onDecide: (decision: "allow" | "deny") => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (decision: "allow" | "deny") => {
    setBusy(true);
    try {
      await onDecide(decision);
    } finally {
      setBusy(false);
    }
  };

  // Text at every breakpoint (per review): action buttons the user presses must read as words —
  // "允许/Allow" and "拒绝/Deny" — never as bare glyphs; iconic shorthand is reserved for
  // passive indicators. The buttons live on their own row under the (wrapping) argument
  // preview, so the words cost no width the pending card doesn't already have.
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="primary" disabled={busy} onClick={() => void decide("allow")}>
        {S.chat.approve}
      </Button>
      <Button size="sm" disabled={busy} onClick={() => void decide("deny")}>
        {S.chat.deny}
      </Button>
    </div>
  );
}
