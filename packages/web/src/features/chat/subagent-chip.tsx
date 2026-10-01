/**
 * A spawned child session's row in the parent's stream, drawn by the shared UI package's
 * `SubagentChip`: this resolves the child's agent name from the Project's agents and sessions,
 * finds whether an approval waits anywhere in the child's subtree (so a nested approval stays
 * discoverable with the panel closed, and is announced in the row's name), and opens the
 * subagents panel focused on the child through ctx.onOpenSubagent.
 */
import { SubagentChip } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { hasPendingWithinOrigin } from "../../lib/omni/stream-model";
import type { StreamModel } from "../../lib/omni/stream-model";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import { resolveAgentLabel, shortSessionId } from "./agent-topology";
import type { StreamRenderContext } from "./message-stream";

export function SessionSubagentChip({
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
  const resolvedAgentId = model.meta?.agentId ?? agentId;
  const label =
    resolveAgentLabel({ sessionId, agentId: resolvedAgentId }, agents, sessions) ?? S.chat.subagent;
  const pending = hasPendingWithinOrigin(ctx.pendingApprovals.keys(), [...ctx.origin, sessionId]);

  return (
    <SubagentChip
      label={label}
      name={`${S.chat.subagent} ${label}${pending ? ` · ${S.chat.approvalWaiting}` : ""}`}
      avatarId={resolvedAgentId ?? sessionId}
      {...(sessionId ? { tag: shortSessionId(sessionId) } : {})}
      running={running}
      pending={pending}
      onOpen={() => ctx.onOpenSubagent?.(sessionId, ctx.origin)}
    />
  );
}
