/**
 * A tool call waiting on a person's decision: the call's name and the arguments it will run
 * with, and the two buttons that decide it.
 *
 * The block is always on screen while the call waits, whatever its card's collapsed state, so the
 * reader never has to open anything to find what they are approving. Below `sm` the argument
 * preview wraps in full (no truncation, no inner scroll — the block may grow): the person must be
 * able to read the whole command before deciding. From `sm` up it stays one line. A file tool's
 * decoded payload (what it will write) follows in a scrollable block, since a bare path does not
 * say what is being approved.
 *
 * The buttons are words at every breakpoint: an action a person presses reads as "Allow" and
 * "Deny", never as a glyph. Both stay disabled while the decision is being submitted.
 */
import { useState } from "react";
import { Button } from "../../actions/button/button";

export type ApprovalChoice = "allow" | "deny";

/** The two buttons' words. */
export interface ApprovalLabels {
  allow: string;
  deny: string;
}

export function ApprovalButtons({
  onDecide,
  labels,
}: {
  /** Submits the decision; the buttons stay disabled until it settles. */
  onDecide: (decision: ApprovalChoice) => Promise<void>;
  labels: ApprovalLabels;
}) {
  const [busy, setBusy] = useState(false);

  const decide = async (decision: ApprovalChoice) => {
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
        {labels.allow}
      </Button>
      <Button size="sm" disabled={busy} onClick={() => void decide("deny")}>
        {labels.deny}
      </Button>
    </div>
  );
}

/** What a waiting call asks of the person: the arguments to read and the decision to make. */
export interface ApprovalRequest {
  /** The one-line argument preview: the command, the file path, or the raw arguments. */
  preview: string;
  /** A file tool's decoded payload (the rewrite it will make), shown in full; null for others. */
  payload?: string | null;
  onDecide: (decision: ApprovalChoice) => Promise<void>;
  labels: ApprovalLabels;
}

export interface ApprovalBlockProps extends ApprovalRequest {
  /** The call's name as shown on its row (an alias, when the caller resolves one). */
  name: string;
  /** The tool's own name when `name` is an alias: the name chip's tooltip. */
  nameTooltip?: string;
}

export function ApprovalBlock({
  name,
  nameTooltip,
  preview,
  payload,
  onDecide,
  labels,
}: ApprovalBlockProps) {
  return (
    <div className="border-t border-line-muted bg-tone-attention-bg px-3 py-2">
      <div className="mb-2 flex items-start gap-2 sm:items-center">
        <span
          data-tooltip={nameTooltip}
          className="shrink-0 rounded-md bg-surface px-1.5 py-0.5 font-mono text-xs font-semibold text-fg"
        >
          {name}
        </span>
        <span className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs text-fg-muted sm:truncate">
          {preview}
        </span>
      </div>
      {payload !== undefined && payload !== null && (
        <pre className="mb-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-md bg-surface/70 px-2 py-1.5 text-xs leading-5 text-fg">
          {payload}
        </pre>
      )}
      <ApprovalButtons onDecide={onDecide} labels={labels} />
    </div>
  );
}
