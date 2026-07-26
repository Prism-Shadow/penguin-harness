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

  // Below sm the buttons drop their text and keep only a colored glyph (✓ accent / ✕ red) so
  // the approval row stays one line on phones; aria-label pins the accessible name either way
  // (tests and screen readers keep resolving the buttons by "允许"/"Allow" and "拒绝"/"Deny").
  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="primary"
        disabled={busy}
        aria-label={S.chat.approve}
        title={S.chat.approve}
        onClick={() => void decide("allow")}
      >
        <span aria-hidden className="sm:hidden">
          ✓
        </span>
        <span className="hidden sm:inline">{S.chat.approve}</span>
      </Button>
      <Button
        size="sm"
        disabled={busy}
        aria-label={S.chat.deny}
        title={S.chat.deny}
        onClick={() => void decide("deny")}
      >
        <span aria-hidden className="text-red-600 sm:hidden dark:text-red-400">
          ✕
        </span>
        <span className="hidden sm:inline">{S.chat.deny}</span>
      </Button>
    </div>
  );
}
