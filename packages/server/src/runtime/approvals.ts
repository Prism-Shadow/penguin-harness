/**
 * Tool call approval: ApproveFn factory + pending
 * approval registry.
 *
 * Approval mode semantics match the CLI (packages/cli/src/approval.ts):
 *   allow-all auto-approves; deny-all auto-denies; read-only allows read-only tools
 *   (permission==="r") and routes the rest to manual approval; always-ask routes
 *   everything to manual approval. Routing to manual approval registers a pending entry
 *   and pushes an `approval_request` via SSE, suspending until the frontend decides via
 *   `POST /approvals/:toolCallId`; no timeout — pending approvals are resolved to deny
 *   when the Task is interrupted (then proceeds through the abort flow).
 *
 * An unattended Session takes that one route differently: there is no frontend to ask, so
 * the call is denied on the spot instead of suspending forever (see `unattended` below).
 *
 * A call a command-policy `ask` rule matched never reaches the mode: core hands it to the
 * same callback with a policy reason (`context.reason`), and the callback takes the manual
 * route under every mode but deny-all (still a denial) — with the reason on the pending
 * entry, so the card can say why it asks.
 *
 * Every approval decision re-reads the current approval_mode (`getMode` reads the DB),
 * so mode changes take effect immediately.
 * Docs: /docs/tools § "Approval".
 */
import type {
  ApprovalMode,
  ApprovalReason,
  Approvals,
  PendingApproval,
} from "@prismshadow/penguin-library-session";
import type {
  ApprovalDecision,
  ApproveFn,
  AmspRecord,
  PolicyDenial,
  ToolCallPayload,
} from "@prismshadow/penguin-core";

// The Approvals contract and PendingApproval moved to @prismshadow/penguin-library-session
// (the AgentState closed shape reaches them); re-exported here for the existing import paths.
export type { Approvals, PendingApproval };

interface PendingEntry extends PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
}

/** Pending approval registry (key = tool_call_id), one per Session runtime. */
export class ApprovalRegistry implements Approvals {
  private readonly pending = new Map<string, PendingEntry>();
  /** Inside a multi-entry change (`wait` replacing an entry, `denyAll`, `denyMain`): reported once, at its end. */
  private batching = false;

  /**
   * `onChange` hears every change of `size`, once per call that made it (a `denyAll` over
   * three entries is one change) and never for a call that left the count where it was.
   */
  constructor(private readonly onChange?: () => void) {}

  get size(): number {
    return this.pending.size;
  }

  /** All currently pending approvals (for subscription replay). */
  list(): PendingApproval[] {
    return [...this.pending.values()].map(({ toolCall, origin, reason }) => ({
      toolCall,
      ...(origin !== undefined ? { origin } : {}),
      ...(reason !== undefined ? { reason } : {}),
    }));
  }

  /** Register and wait for a decision. Re-registering the same id (defensive) resolves the old entry as deny. */
  wait(toolCall: AmspRecord<ToolCallPayload>, reason?: ApprovalReason): Promise<ApprovalDecision> {
    const id = toolCall.payload.tool_call_id;
    return this.batch(
      () =>
        new Promise<ApprovalDecision>((resolve) => {
          this.pending.get(id)?.resolve("deny");
          const entry: PendingEntry = {
            toolCall,
            ...(toolCall.origin !== undefined ? { origin: toolCall.origin } : {}),
            ...(reason !== undefined ? { reason } : {}),
            resolve: (decision) => {
              if (this.pending.get(id) !== entry) return;
              this.pending.delete(id);
              this.changed();
              resolve(decision);
            },
          };
          this.pending.set(id, entry);
        }),
    );
  }

  /** Submit a decision; returns false if not found (already decided/unknown). */
  decide(toolCallId: string, decision: ApprovalDecision): boolean {
    const entry = this.pending.get(toolCallId);
    if (!entry) return false;
    entry.resolve(decision);
    return true;
  }

  /** Interruption convergence: resolve all pending approvals as deny. */
  denyAll(): void {
    this.batch(() => {
      for (const entry of [...this.pending.values()]) entry.resolve("deny");
    });
  }

  /**
   * Task-boundary convergence: deny only the MAIN session's pending approvals (no origin).
   * An origin-tagged approval belongs to a subagent child that outlives the parent's task —
   * the child is still blocked on the question, so it stays pending for the user; it is
   * denied only with the child itself (kill/dispose paths use denyAll).
   */
  denyMain(): void {
    this.batch(() => {
      for (const entry of [...this.pending.values()]) {
        if (entry.origin === undefined || entry.origin.length === 0) entry.resolve("deny");
      }
    });
  }

  private changed(): void {
    if (!this.batching) this.onChange?.();
  }

  /** Runs `fn` as one change: `onChange` hears it once, and only when the count moved. */
  private batch<T>(fn: () => T): T {
    if (this.batching) return fn();
    const before = this.pending.size;
    this.batching = true;
    try {
      return fn();
    } finally {
      this.batching = false;
      if (this.pending.size !== before) this.onChange?.();
    }
  }
}

/**
 * Build the approve callback: re-reads the approval mode on every call; when routed to
 * manual approval, registers a pending entry and suspends after pushing an
 * `approval_request` server event via `publishRequest` — unless the Session is unattended,
 * in which case that one route answers deny immediately. A call core hands over with a
 * policy reason (a command-policy `ask` rule matched it) takes the manual route under every
 * mode — allow-all and read-only included — except deny-all, which still denies; the reason
 * rides on the request. The unattended deny answers with the rule named (see PolicyDenial),
 * so the model reads which rule refused the call rather than a person who never saw it.
 */
export function makeApprove(args: {
  getMode: () => ApprovalMode;
  /** A tool's permission level, from the running context's toolset (core Session.toolPermission): strict-tier — a permission edit applies when the next context opens. */
  toolPermission: (name: string) => "r" | "rw" | undefined;
  registry: Approvals;
  publishRequest: (pending: PendingApproval) => void;
  /**
   * Whether nobody is watching this Session — an organization's desk, ticket and spawned
   * sessions, the only unattended ones the server drives. Re-read per decision like the
   * mode. It changes exactly one route: a call the mode would hand to a person is denied at
   * once instead of parking for an answer that is never coming, and no `approval_request`
   * is pushed. The automatic answers (allow-all, deny-all, read-only's read tools) and the
   * command policy's veto are untouched — they never asked anyone in the first place. A
   * command-policy `ask` hit takes the manual route too, so an unattended Session denies it
   * at once, naming the rule (see PolicyDenial): nobody is there to give the go-ahead.
   * Absent (development mode) keeps the suspending behaviour.
   */
  unattended?: () => boolean;
}): ApproveFn {
  const { getMode, toolPermission, registry, publishRequest, unattended } = args;
  const manual = (
    toolCall: AmspRecord<ToolCallPayload>,
    reason?: ApprovalReason,
  ): Promise<ApprovalDecision | PolicyDenial> => {
    if (unattended?.() === true) {
      return Promise.resolve<ApprovalDecision | PolicyDenial>(
        reason !== undefined ? { decision: "deny", rule: reason.rule } : "deny",
      );
    }
    const promise = registry.wait(toolCall, reason);
    publishRequest({
      toolCall,
      ...(toolCall.origin !== undefined ? { origin: toolCall.origin } : {}),
      ...(reason !== undefined ? { reason } : {}),
    });
    return (async () => {
      const answer = await promise;
      // A person's refusal of a policy-asked call keeps the rule with it, marked as the
      // person's: the rendered line names who answered and under which rule (see
      // PolicyDenial.by). Without the mark a named deny reads as the rule's own answer.
      return reason !== undefined && answer === "deny"
        ? { decision: "deny", rule: reason.rule, by: "user" }
        : answer;
    })();
  };
  return async (toolCall, context) => {
    const mode = getMode();
    // The Project's security policy wants a person: the mode's automatic yes does not apply.
    // deny-all never parks a request either, but its denial still names the rule the same
    // way an unattended denial does — a refusal the policy caused is the rule's answer, not
    // a person's.
    if (context?.reason !== undefined) {
      return mode === "deny-all"
        ? { decision: "deny", rule: context.reason.rule }
        : manual(toolCall, context.reason);
    }
    switch (mode) {
      case "allow-all":
        return "allow";
      case "deny-all":
        return "deny";
      case "read-only":
        // Auto-approve read-only tools; route read-write/unknown tools to manual approval (matches CLI semantics).
        if (toolPermission(toolCall.payload.name) === "r") return "allow";
        return manual(toolCall);
      case "always-ask":
      default:
        return manual(toolCall);
    }
  };
}
