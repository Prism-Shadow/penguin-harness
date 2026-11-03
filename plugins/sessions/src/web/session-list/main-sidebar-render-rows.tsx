import type { DragEvent as ReactDragEvent } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { formatRelativeShort } from "../../lib/format";
import { sessionBackgroundTasks, sessionRowActivity } from "../../lib/session-activity";
import { SESSION_DRAG_MIME } from "../../lib/main-sidebar-persistence";
import { SidebarSessionRow } from "./main-session-row";
import type { useMainSidebarAgentNameById } from "./main-sidebar-agent-name-by-id";

/** Consecutive live main statements 135..135, called once in original hook order. */
export function useMainSidebarRenderRows(scope: ReturnType<typeof useMainSidebarAgentNameById>) {
  const {
    locale,
    activeSessionId,
    sessionSeen,
    scheduledSessions,
    pinnedSessions,
    dragSession,
    setDragSession,
    dropHint,
    setDropHint,
    setDeletingSession,
    setRenamingSession,
    setRenameText,
    setRenameError,
    setMessagingSession,
    toggleSessionPin,
    commitManualDrop,
    archiveSession,
    openSession,
    agentNameById,
  } = scope;

  /** Session rows shared by both modes; withAgentHint adds a small Agent avatar per row (workspace mode, where the group no longer names the Agent). */
  const renderRows = (
    rows: SessionInfo[],
    withAgentHint: boolean,
    /** Manual sort only: the drag scope (group key) plus the group's FULL ordered list — the drop must commit every loaded row of the partition, not the display-capped slice the user happens to see. */
    dragCtx?: { scope: string; fullRows: SessionInfo[] },
  ) => (
    <ul className="space-y-px">
      {rows.map((s) => {
        // Manual-sort drag wiring (never while searching — a filtered view is not the real
        // order). A drop stays within its own scope AND its own pin partition: dragging can
        // reorder but never pin or unpin.
        const dragging =
          dragCtx !== undefined && dragSession?.scope === dragCtx.scope ? dragSession : null;
        const samePartition =
          dragging !== null &&
          dragging.id !== s.sessionId &&
          pinnedSessions.has(dragging.id) === pinnedSessions.has(s.sessionId);
        const drag =
          dragCtx === undefined
            ? {}
            : {
                draggable: true,
                onDragStart: (e: ReactDragEvent) => {
                  // Firefox refuses to start a drag without payload data — but the id must
                  // NOT ride on text/plain: the composer is a controlled textarea with no
                  // drop guard, so a mis-aimed reorder would paste a session id straight
                  // into the user's message. A private type is invisible to text drops.
                  e.dataTransfer.setData(SESSION_DRAG_MIME, s.sessionId);
                  e.dataTransfer.effectAllowed = "move" as const;
                  setDragSession({ scope: dragCtx.scope, id: s.sessionId });
                },
                onDragEnd: () => {
                  setDragSession(null);
                  setDropHint(null);
                },
                onDragOver: (e: ReactDragEvent) => {
                  if (!dragging || !samePartition) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY - rect.top > rect.height / 2;
                  setDropHint((prev) =>
                    prev?.id === s.sessionId && prev.after === after
                      ? prev
                      : { id: s.sessionId, after },
                  );
                },
                onDragLeave: () => setDropHint((prev) => (prev?.id === s.sessionId ? null : prev)),
                onDrop: (e: ReactDragEvent) => {
                  if (!dragging || !samePartition) return;
                  e.preventDefault();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY - rect.top > rect.height / 2;
                  // The FULL partition (every loaded row of this group on the dragged
                  // row's side of the pin boundary), not the visible slice: committing
                  // only the capped rows would drop the hidden ones out of the stored
                  // sequence, and they would come back as "newcomers" at the top.
                  const partitionIds = dragCtx.fullRows
                    .filter(
                      (r) => pinnedSessions.has(r.sessionId) === pinnedSessions.has(dragging.id),
                    )
                    .map((r) => r.sessionId);
                  commitManualDrop(partitionIds, s.sessionId, after);
                  setDragSession(null);
                  setDropHint(null);
                },
                dropEdge:
                  samePartition && dropHint?.id === s.sessionId
                    ? dropHint.after
                      ? ("below" as const)
                      : ("above" as const)
                    : null,
              };
        return (
          <SidebarSessionRow
            key={s.sessionId}
            s={s}
            active={s.sessionId === activeSessionId}
            // Busy / settled / read / never-ran, decided in one place (session-activity.ts) so
            // the whole transition sequence is testable without a DOM.
            activity={sessionRowActivity(s, sessionSeen, activeSessionId)}
            background={sessionBackgroundTasks(s)}
            scheduled={scheduledSessions.has(s.sessionId)}
            pinned={pinnedSessions.has(s.sessionId)}
            // Last ACTIVITY, not creation: the server stamps lastActiveAt when a run
            // starts and again when it ends, so a running row shows its run-start time
            // (it recedes while the run continues — the hourglass beside it is what says
            // "active right now"). CLI-adopted and subagent rows are not
            // driven by this server, so theirs stays at createdAt.
            lastActive={formatRelativeShort(s.lastActiveAt, locale)}
            locale={locale}
            {...(withAgentHint ? { agentHint: agentNameById.get(s.agentId) ?? s.agentId } : {})}
            {...drag}
            onOpen={openSession}
            onTogglePin={(x) => toggleSessionPin(x.sessionId)}
            onRename={(x) => {
              setRenameError(null);
              setRenameText(x.title ?? "");
              setRenamingSession(x);
            }}
            onMessaging={(x) => setMessagingSession(x)}
            onDelete={(x) => setDeletingSession(x)}
            onArchive={(x) => void archiveSession(x)}
          />
        );
      })}
    </ul>
  );
  return { ...scope, renderRows };
}
