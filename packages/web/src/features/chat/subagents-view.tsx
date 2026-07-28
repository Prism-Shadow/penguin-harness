/**
 * Subagents panel content: one Task's call graph on top (root = the main session, one node per
 * spawned child; clicking a node switches the conversation below) and the selected child's
 * live conversation underneath, rendered with the SAME machinery as the main chat
 * (MessageStream over the child StreamModel with ctx.origin set to the child's chain) — so
 * streaming, nested tool cards, chips for deeper spawns, and pending approvals all keep
 * working inside the panel.
 *
 * Which Task: the LATEST by default (toolbar open / session switch — a new Task then resets
 * the graph to its own agents as it streams); a chip click pins `taskScope` to that chip's
 * Task instead (use-subagents-panel.ts), so a chip on an older turn shows that turn's
 * HISTORICAL graph via extractTopologyForChild — falling back to the latest Task when the
 * anchor is no longer referenced (e.g. a resync swapped the model).
 *
 * Selection: an explicit chip click (focusRequest) or a node click wins; with no explicit
 * choice the first child of the displayed Task is auto-focused (so opening the panel while a
 * subagent is spawning immediately shows it). Selecting the root shows a note instead of
 * duplicating the main transcript. A focused child outside the displayed Task keeps its
 * conversation visible (found by walking the origin chain); the graph simply has no
 * highlighted node.
 */
import { useEffect, useMemo, useState } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { StreamModel } from "../../lib/omni/stream-model";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { EmptyState } from "../../components/ui/empty-state";
import { StatusIcon } from "../../components/ui/status-icon";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  extractTopology,
  extractTopologyForChild,
  modelAtOrigin,
  resolveAgentLabel,
  shortSessionId,
} from "./agent-topology";
import type { TopologyNode } from "./agent-topology";
import { AgentTopologyView } from "./agent-topology-view";
import { MessageStream } from "./message-stream";
import type { StreamRenderContext } from "./message-stream";

interface Selection {
  sessionId: string;
  /** ctx.origin chain of the selected conversation (ends with its own session id; empty = the root/main session). */
  origin: string[];
}

export function SubagentsView({
  session,
  model,
  version,
  taskRunning,
  ctx,
  focusRequest,
  taskScope,
}: {
  session: SessionInfo;
  model: StreamModel;
  /** View-model version (repaint signal): keys the topology recompute and drives MessageStream's auto-follow. */
  version: number;
  taskRunning: boolean;
  /** Main-session render context (origin []): the child conversation derives its own from it. */
  ctx: StreamRenderContext;
  focusRequest: Selection | null;
  /** Displayed Task scope (see use-subagents-panel.ts): null = latest; an anchor pins the historical Task containing that child. */
  taskScope: { anchorSessionId: string } | null;
}) {
  const { agents } = useProject();
  const { sessions } = useSessions();
  const [selected, setSelected] = useState<Selection | null>(null);

  // A chip click focuses that child (fresh-object identity: re-clicking the same chip re-fires).
  useEffect(() => {
    if (focusRequest) {
      setSelected({ sessionId: focusRequest.sessionId, origin: focusRequest.origin });
    }
  }, [focusRequest]);

  const nodes = useMemo(
    () =>
      // A pinned scope (chip click) shows THAT Task's graph — historical or latest alike; when
      // its anchor is no longer referenced in the stream, fall back to the latest Task.
      (taskScope
        ? extractTopologyForChild(model, session.sessionId, taskRunning, taskScope.anchorSessionId)
        : null) ?? extractTopology(model, session.sessionId, taskRunning),
    // version is the model's change signal (items mutate in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, version, session.sessionId, taskRunning, taskScope],
  );

  // No explicit selection yet: auto-focus the displayed Task's first child (null when none spawned).
  const firstChild = nodes.find((n) => n.depth > 0) ?? null;
  const active: Selection | null =
    selected ??
    (firstChild ? { sessionId: firstChild.sessionId, origin: firstChild.origin } : null);

  const labelFor = (node: TopologyNode): string => {
    if (node.depth === 0) {
      const agent = agents.find((a) => a.agentId === session.agentId);
      // Same empty-name rule as resolveAgentLabel: an empty display name falls back to the id.
      return agent ? (agent.name?.length ? agent.name : agent.agentId) : session.agentId;
    }
    // Last-resort label is the short session id, not a generic word: two unknown children must stay distinguishable in the graph.
    return resolveAgentLabel(node, agents, sessions) ?? shortSessionId(node.sessionId);
  };

  const isRoot = active !== null && active.origin.length === 0;
  const activeNode = active ? (nodes.find((n) => n.sessionId === active.sessionId) ?? null) : null;
  const activeModel = active && !isRoot ? modelAtOrigin(model, active.origin) : null;
  const activeLabel = activeNode
    ? labelFor(activeNode)
    : active
      ? (resolveAgentLabel(
          { sessionId: active.sessionId, agentId: activeModel?.meta?.agentId ?? null },
          agents,
          sessions,
        ) ?? S.chat.subagent)
      : "";
  const activeRunning = activeNode?.running ?? false;

  // Same derivation the subagent card used: the child conversation's approval keys and
  // "Reasoning & Tools" running state follow the child's chain and its own running flag.
  const childCtx: StreamRenderContext | null = active
    ? { ...ctx, origin: active.origin, taskRunning: activeRunning }
    : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Call graph of the displayed Task — latest by default, a chip's Task when pinned (capped height; scrolls both ways for deep/wide trees). */}
      <div className="shrink-0 border-b border-gray-200 px-3 pb-2 pt-1.5 dark:border-gray-800">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {S.subagentPanel.topologyLabel}
        </p>
        {nodes.length > 1 ? (
          <div className="max-h-48 overflow-y-auto">
            <AgentTopologyView
              nodes={nodes}
              selectedId={active?.sessionId ?? null}
              labelFor={labelFor}
              onSelect={(node) => setSelected({ sessionId: node.sessionId, origin: node.origin })}
            />
          </div>
        ) : (
          <p className="py-1 text-xs text-gray-400 dark:text-gray-500">{S.subagentPanel.empty}</p>
        )}
      </div>

      {/* Selected conversation (or the root note / empty state). */}
      {active === null ? (
        <div className="min-h-0 flex-1">
          <EmptyState title={S.subagentPanel.empty} />
        </div>
      ) : isRoot ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {S.subagentPanel.mainSessionNote}
          </p>
        </div>
      ) : activeModel === null ? (
        // The chain broke (e.g. a resync swapped in a fresh model and this child hasn't re-streamed yet).
        <div className="min-h-0 flex-1">
          <EmptyState title={S.subagentPanel.empty} />
        </div>
      ) : (
        <>
          {/* Slim identity strip for the conversation below. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1.5 dark:border-gray-800/60">
            <AgentAvatar
              id={activeModel.meta?.agentId ?? active.sessionId}
              name={activeLabel}
              size={16}
            />
            <span className="min-w-0 truncate text-xs font-semibold text-gray-700 dark:text-gray-300">
              {activeLabel}
            </span>
            <span
              title={active.sessionId}
              className="shrink-0 font-mono text-[10px] text-gray-400 dark:text-gray-500"
            >
              {shortSessionId(active.sessionId)}
            </span>
            {activeRunning && (
              <StatusIcon state="running" size={10} label={S.chat.subagentRunning} />
            )}
          </div>
          <div className="min-h-0 flex-1">
            {/* Keyed by child: switching nodes resets scroll-follow instead of carrying the old position over. */}
            {childCtx && (
              <MessageStream
                key={active.sessionId}
                items={activeModel.items}
                version={version}
                ctx={childCtx}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
