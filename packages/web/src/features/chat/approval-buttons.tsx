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
