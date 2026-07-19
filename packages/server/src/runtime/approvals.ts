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
 * Every approval decision re-reads the current approval_mode (`getMode` reads the DB),
 * so mode changes take effect immediately.
 * Docs: /docs/tools § "Approval".
 */
import type { ApprovalMode } from "../api/types.js";
import type {
  ApprovalDecision,
  ApproveFn,
  OmniMessage,
  ToolCallPayload,
} from "@prismshadow/penguin-core";

export interface PendingApproval {
  toolCall: OmniMessage<ToolCallPayload>;
  origin?: string[];
}

interface PendingEntry extends PendingApproval {
  resolve: (decision: ApprovalDecision) => void;
}

/** Pending approval registry (key = tool_call_id), one per Session runtime. */
export class ApprovalRegistry {
  private readonly pending = new Map<string, PendingEntry>();

  get size(): number {
    return this.pending.size;
  }

  /** All currently pending approvals (for subscription replay). */
  list(): PendingApproval[] {
    return [...this.pending.values()].map(({ toolCall, origin }) => ({
      toolCall,
      ...(origin !== undefined ? { origin } : {}),
    }));
  }

  /** Register and wait for a decision. Re-registering the same id (defensive) resolves the old entry as deny. */
  wait(toolCall: OmniMessage<ToolCallPayload>): Promise<ApprovalDecision> {
    const id = toolCall.payload.tool_call_id;
    this.pending.get(id)?.resolve("deny");
    return new Promise<ApprovalDecision>((resolve) => {
      const entry: PendingEntry = {
        toolCall,
        ...(toolCall.origin !== undefined ? { origin: toolCall.origin } : {}),
        resolve: (decision) => {
          this.pending.delete(id);
          resolve(decision);
        },
      };
      this.pending.set(id, entry);
    });
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
    for (const entry of [...this.pending.values()]) entry.resolve("deny");
  }
}

/**
 * Build the approve callback: re-reads the approval mode on every call; when routed to
 * manual approval, registers a pending entry and suspends after pushing an
 * `approval_request` server event via `publishRequest`.
 */
export function makeApprove(args: {
  getMode: () => ApprovalMode;
  toolPermission: (name: string) => "r" | "rw" | undefined;
  registry: ApprovalRegistry;
  publishRequest: (pending: PendingApproval) => void;
}): ApproveFn {
  const { getMode, toolPermission, registry, publishRequest } = args;
  const manual = (toolCall: OmniMessage<ToolCallPayload>): Promise<ApprovalDecision> => {
    const promise = registry.wait(toolCall);
    publishRequest({
      toolCall,
      ...(toolCall.origin !== undefined ? { origin: toolCall.origin } : {}),
    });
    return promise;
  };
  return async (toolCall) => {
    switch (getMode()) {
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
