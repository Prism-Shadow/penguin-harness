/**
 * Subagents panel content: one Task's call graph on top (root = the main session, one node per
 * spawned child; clicking a node switches the conversation below) and the selected child's
 * live conversation underneath, rendered with the SAME machinery as the main chat
 * (MessageStream over the child StreamModel with ctx.origin set to the child's chain) — so
 * streaming, nested tool cards, chips for deeper spawns, and pending approvals all keep
 * working inside the panel.
 *
 * Which Task: the most recent SUBAGENT-BEARING one by default — a plain user message never
 * wipes the graph; a new Task takes over the moment it spawns its own child (see
 * extractTopology). A chip click pins `taskScope` to that chip's Task instead (the chat
 * page's subagentTaskScope), so a chip on an older turn shows that turn's HISTORICAL graph
 * via extractTopologyForChild — falling back to the default scope when the anchor is no
 * longer referenced (e.g. a resync swapped the model).
 *
 * Selection: an explicit chip click (focusRequest) or a node click wins; with no explicit
 * choice the first child of the displayed Task is auto-focused (so opening the panel while a
 * subagent is spawning immediately shows it). Selecting the root shows a note instead of
 * duplicating the main transcript. A focused child outside the displayed Task keeps its
 * conversation visible (found by walking the origin chain); the graph simply has no
 * highlighted node.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type {
  ApprovalMode,
  ModelInfo,
  SessionInfo,
  SkillMetadataItem,
  SubagentRuntimeInfo,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import { ApiError } from "../../api/client";
import { abortSubagent, getAgentSkills, messageSubagent } from "../../api/endpoints";
import { toastError } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import type { NestedSessionMeta, StreamModel } from "../../lib/omni/stream-model";
import { ChatInput } from "./chat-input";
import { AgentAvatar } from "../../components/ui/agent-avatar";
import { EmptyState } from "../../components/ui/empty-state";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { StatusIcon } from "../../components/ui/status-icon";
import { ICON_SIZE } from "../../lib/icon-scale";
import { noteSessionSeen } from "../../lib/session-seen";
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
  subagents,
  models,
  approvalMode,
  onChangeApprovalMode,
  modeSaving,
  parentThinkingLevel,
}: {
  session: SessionInfo;
  model: StreamModel;
  /** View-model version (repaint signal): keys the topology recompute and drives MessageStream's auto-follow. */
  version: number;
  taskRunning: boolean;
  /** Main-session render context (origin []): the child conversation derives its own from it. */
  ctx: StreamRenderContext;
  focusRequest: Selection | null;
  /** Displayed Task scope (the chat page's subagentTaskScope): null = latest; an anchor pins the historical Task containing that child. */
  taskScope: { anchorSessionId: string } | null;
  /** Live subagent children from the server's task_state (structural liveness): overrides the topology's text heuristics; empty for dead runtimes. */
  subagents: SubagentRuntimeInfo[];
  /** Project model list (the child composer's locked-model badge and context-window lookup). */
  models: ModelInfo[];
  /** The PARENT session's approval mode — child approvals are judged by it (the same value the main composer edits). */
  approvalMode: ApprovalMode;
  onChangeApprovalMode: (mode: ApprovalMode) => void;
  modeSaving: boolean;
  /** The parent session's effective thinking level ("" = unknown): the child composer's display fallback — a child inherits it at spawn unless the spawning call pinned its own. */
  parentThinkingLevel: string;
}) {
  const { agents, setCurrentAgentId } = useProject();
  const { sessions } = useSessions();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Selection | null>(null);

  // A chip click focuses that child (fresh-object identity: re-clicking the same chip re-fires).
  useEffect(() => {
    if (focusRequest) {
      setSelected({ sessionId: focusRequest.sessionId, origin: focusRequest.origin });
    }
  }, [focusRequest]);

  // Structural child liveness from the server (session id → running): the topology consults
  // it before its text heuristics, so revived and panel-started rounds read correctly.
  const liveStates = useMemo(
    () => new Map(subagents.map((s) => [s.sessionId, s.running])),
    [subagents],
  );

  const nodes = useMemo(
    () =>
      // A pinned scope (chip click) shows THAT Task's graph — historical or latest alike; when
      // its anchor is no longer referenced in the stream, fall back to the latest Task.
      (taskScope
        ? extractTopologyForChild(
            model,
            session.sessionId,
            taskRunning,
            taskScope.anchorSessionId,
            liveStates,
          )
        : null) ?? extractTopology(model, session.sessionId, taskRunning, liveStates),
    // version is the model's change signal (items mutate in place).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, version, session.sessionId, taskRunning, taskScope, liveStates],
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

  /**
   * Jump to the selected subagent's own Session in the chat area. Subagent runs register
   * as Sessions (session_created over the parent's channel), so the child opens with the
   * full chat surface — its own composer, panels and history. Mirrors the sidebar's
   * openSession: the seen marker is stamped and the current Agent follows the child's.
   */
  const openAsSession = (): void => {
    if (!active) return;
    const row = sessions.find((s) => s.sessionId === active.sessionId);
    if (row) noteSessionSeen(row.projectId, row.sessionId, row.lastActiveAt);
    const agentId = row?.agentId ?? activeModel?.meta?.agentId ?? null;
    if (agentId !== null) setCurrentAgentId(agentId);
    navigate(`/chat/${active.sessionId}`);
  };

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
          {/* Slim identity strip for the conversation below. The spawning call's description
              belongs to its node in the graph above, not here — one line, one place. */}
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
            <span className="min-w-0 flex-1" />
            {/* Jump out of the panel: the child conversation as a full Session. */}
            <button
              type="button"
              title={S.subagentPanel.openAsSession}
              aria-label={S.subagentPanel.openAsSession}
              data-testid="subagent-open-session"
              onClick={openAsSession}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <GlyphIcon
                d="M14 4h6v6M20 4l-8 8M10 6H5a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"
                size={ICON_SIZE.rowLead}
              />
            </button>
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
          {/* Keyed by child too: switching nodes must not carry a half-typed message over. */}
          <SubagentComposer
            key={`composer-${active.sessionId}`}
            sessionId={session.sessionId}
            childSessionId={active.sessionId}
            running={activeRunning}
            meta={activeModel.meta}
            contextNow={activeModel.stats.contextNow}
            deliveredInputs={countDeliveredInputs(activeModel)}
            models={models}
            approvalMode={approvalMode}
            onChangeApprovalMode={onChangeApprovalMode}
            modeSaving={modeSaving}
            fallbackThinkingLevel={activeNode?.spawnThinkingLevel ?? parentThinkingLevel}
          />
        </>
      )}
    </div>
  );
}

/**
 * User-side inputs already visible in the child's stream (follow-up prompts and delivered
 * steering interjections alike): the composer's "queued" hint retires when this grows past
 * its value at queue time — whichever way the message reached the child.
 */
function countDeliveredInputs(model: StreamModel): number {
  let n = 0;
  for (const item of model.items) {
    if (item.kind === "user_text" || item.kind === "user_steering") n += 1;
  }
  return n;
}

/**
 * The selected child's composer (#272): the SAME ChatInput as the main conversation, in its
 * subagent variant — body, skills and slash skill commands, per-turn thinking level, context
 * ring (the child's own usage), locked-model badge, and the approval-mode selector (the
 * PARENT session's mode — child approvals are judged by it). Send semantics are a user input
 * on the child, whatever its state: steering while it runs, a follow-up round while idle, a
 * revival (resume-session) when it was released; the stop face on the action button aborts
 * only the child's current run. All of it lands on the same core channel input_subagent uses.
 */
function SubagentComposer({
  sessionId,
  childSessionId,
  running,
  meta,
  contextNow,
  deliveredInputs,
  models,
  approvalMode,
  onChangeApprovalMode,
  modeSaving,
  fallbackThinkingLevel,
}: {
  sessionId: string;
  childSessionId: string;
  running: boolean;
  meta: NestedSessionMeta | null;
  contextNow: number;
  deliveredInputs: number;
  models: ModelInfo[];
  approvalMode: ApprovalMode;
  onChangeApprovalMode: (mode: ApprovalMode) => void;
  modeSaving: boolean;
  /** Display fallback for the thinking picker while the user hasn't picked: the spawn call's explicit level, else the parent session's effective level (what the child inherited). */
  fallbackThinkingLevel: string;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Skills of the CHILD's agent (it may differ from the parent's): candidates for the
  // toolbar dropdown and the slash menu; a failed fetch reads as no skills.
  const [skills, setSkills] = useState<SkillMetadataItem[]>([]);
  useEffect(() => {
    let stale = false;
    setSkills([]);
    const agentId = meta?.agentId;
    if (!projectId || !agentId) return;
    getAgentSkills(projectId, agentId)
      .then((res) => {
        if (!stale) setSkills(res.skills);
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [projectId, meta?.agentId]);

  // Per-turn thinking level for the child's NEXT round ("" = untouched, follow the child's
  // own config): mirrors the main composer's per-session pick, scoped to this child.
  const [turnLevel, setTurnLevel] = useState("");

  const modelRef = meta ? { provider: meta.provider, modelId: meta.modelId } : null;
  const contextWindow = modelRef
    ? models.find((m) => m.provider === modelRef.provider && m.modelId === modelRef.modelId)
        ?.contextWindow
    : undefined;

  const send = (text: string) =>
    messageSubagent(sessionId, childSessionId, text, turnLevel || undefined);
  const sendFailure = (err: unknown): void => {
    toastError(
      err instanceof ApiError && err.code === "subagent_gone"
        ? S.subagentPanel.subagentGone
        : err instanceof Error
          ? err.message
          : String(err),
    );
  };

  return (
    <div className="shrink-0 border-t border-gray-100 px-2 pb-2 pt-2 dark:border-gray-800/60">
      <ChatInput
        variant="subagent"
        status={running ? "running" : "idle"}
        onSend={async (input: TaskInputPart[]) => {
          const text = input
            .filter((p): p is { type: "text"; text: string } => p.type === "text")
            .map((p) => p.text)
            .join("\n\n")
            .trim();
          if (!text) return false;
          try {
            await send(text);
            return true;
          } catch (err) {
            sendFailure(err);
            return false;
          }
        }}
        onSteer={async (text: string) => {
          try {
            await send(text);
            // steered/started/resumed alike: the message reached the child (the race where
            // the round settled mid-send simply started the next one). The queued hint
            // retires when the child's stream shows the delivered input.
            return "queued";
          } catch (err) {
            sendFailure(err);
            return "failed";
          }
        }}
        steeringDeliveredCount={deliveredInputs}
        onStop={async () => {
          await abortSubagent(sessionId, childSessionId).catch(() => undefined);
        }}
        modelRef={modelRef}
        models={models}
        // Display: the user's pick for this child, else what the child actually runs at
        // (spawn-pinned level, else the parent's effective level it inherited). Only an
        // explicit pick rides the send (see messageSubagent's thinkingLevel).
        turnThinkingLevel={turnLevel || fallbackThinkingLevel}
        onChangeTurnThinkingLevel={setTurnLevel}
        {...(contextWindow !== undefined ? { contextWindow } : {})}
        contextNow={contextNow}
        vision={false}
        approvalMode={approvalMode}
        onChangeApprovalMode={onChangeApprovalMode}
        modeSaving={modeSaving}
        agents={[]}
        skills={skills}
      />
    </div>
  );
}
