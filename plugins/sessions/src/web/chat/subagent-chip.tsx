import { S, machineForSession, useAgentAvatarSrc } from "@prismshadow/penguin-web/internal";
import { hasPendingWithinOrigin, type StreamModel } from "@prismshadow/penguin-web/internal";


import { useProject } from "@prismshadow/penguin-web/internal";
import { useSessions } from "@prismshadow/penguin-web/internal";
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
  const avatarSrc = useAgentAvatarSrc();
  const resolvedAgentId = model.meta?.agentId ?? agentId;
  const label =
    resolveAgentLabel({ sessionId, agentId: resolvedAgentId }, agents, sessions) ?? S.chat.subagent;
  const pending = hasPendingWithinOrigin(ctx.pendingApprovals.keys(), [...ctx.origin, sessionId]);

  return (
    <SubagentChip
      label={label}
      name={`${S.chat.subagent} ${label}${pending ? ` · ${S.chat.approvalWaiting}` : ""}`}
      avatarId={resolvedAgentId ?? sessionId}
      avatarSrc={
        resolvedAgentId === null
          ? undefined
          : avatarSrc(resolvedAgentId, machineForSession(sessionId))
      }
      {...(sessionId ? { tag: shortSessionId(sessionId) } : {})}
      running={running}
      pending={pending}
      onOpen={() => ctx.onOpenSubagent?.(sessionId, ctx.origin)}
    />
  );
}
