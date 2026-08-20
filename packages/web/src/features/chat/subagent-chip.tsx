/**
 * Subagent shortcut row: the only trace a spawned child session leaves in the main chat flow
 * (the full nested conversation lives in the subagents side panel). A full-width bar styled
 * like the stream's other collapsed rows (the thinking block / work-group header idiom:
 * rounded border, muted background, left-aligned content) — agent avatar + resolved agent name
 * + short session-id suffix — with a spinner while the child runs and an amber dot (also
 * announced in the accessible name) while any approval is pending anywhere in the child's
 * subtree, so a nested approval stays discoverable with the panel closed. Clicking opens the
 * panel focused on this child via ctx.onOpenSubagent.
 */
import { S } from "../../lib/strings";
import { hasPendingWithinOrigin } from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { resolveAgentLabel, shortSessionId } from "./agent-topology";
import type { StreamRenderContext } from "./message-stream";
import { toneDot } from "../../lib/tone";

export function SubagentChip({
  sessionId,
  model,
  running,
  ctx,
  agentId = null,
}: {
  sessionId: string;
  model: StreamModel;
  running: boolean;
  ctx: StreamRenderContext;
  /** Agent id from the spawning call's arguments (bound tool-card site); the child's own session_meta capture takes priority. */
  agentId?: string | null;
}) {
  const { agents } = useProject();
  const { sessions } = useSessions();
  const label =
    resolveAgentLabel({ sessionId, agentId: model.meta?.agentId ?? agentId }, agents, sessions) ??
    S.chat.subagent;
  const pending = hasPendingWithinOrigin(ctx.pendingApprovals.keys(), [...ctx.origin, sessionId]);
  const name = `${S.chat.subagent} ${label}${pending ? ` · ${S.chat.approvalWaiting}` : ""}`;

  return (
    // Full-width bar, same visual family as the work-group header / thinking row (rounded-md
    // border + muted background + px-3 py-2 left-aligned content) — not a compact pill, so the
    // row lines up with the stream's other collapsed step rows.
    <button
      type="button"
      aria-label={name}
      title={name}
      onClick={() => ctx.onOpenSubagent?.(sessionId, ctx.origin)}
      className="flex w-full items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:border-gray-800 dark:bg-gray-900/60 dark:hover:bg-gray-800/60"
    >
      <AgentAvatar id={model.meta?.agentId ?? agentId ?? sessionId} name={label} size={16} />
      <span className="min-w-0 truncate text-xs font-medium text-gray-700 dark:text-gray-300">
        {label}
      </span>
      {sessionId && (
        <span className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500">
          {shortSessionId(sessionId)}
        </span>
      )}
      {running && (
        <span
          aria-hidden
          className="inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-gray-400 border-t-transparent"
        />
      )}
      {pending && (
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot.attention}`} />
      )}
      <span className="min-w-0 flex-1" />
    </button>
  );
}
