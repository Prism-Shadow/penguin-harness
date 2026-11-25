/**
 * Subagents panel content: one Task's call graph on top (root = the main session, one node per
 * spawned child; clicking a node switches the conversation below) and the selected child's
 * live conversation underneath, rendered with the SAME machinery as the main chat
 * (MessageStream over the child StreamModel with ctx.origin set to the child's chain) — so
 * streaming, nested tool cards, chips for deeper spawns, and pending approvals all keep
 * working inside the panel.
 *
 * The durable parent index supplies turn boundaries and child identities across all history.
 * A loaded conversation contributes live content, liveness and its nested call graph.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { useNavigate } from "react-router";
import type {
  ApprovalMode,
  SessionSandbox,
  ModelInfo,
  SessionInfo,
  SessionPatchRequest,
  SubagentRuntimeInfo,
  TaskInputPart,
} from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  CopyButton,
  EmptyState,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  Pager,
  StatusIcon,
} from "@prismshadow/penguin-ui";
import { ApiError } from "../../api/client";
import { abortSubagent, messageSubagent, patchSession } from "../../api/endpoints";
import { S } from "../../lib/strings";
import type { NestedSessionMeta, StreamModel } from "../../lib/amsp/stream-model";
import { ChatInput, type ComposerControl } from "./chat-input";

import type { PermissionPick } from "../../lib/permission-level";
import { noteSessionSeen } from "../../lib/session-seen";
import { machineForSession, rememberSessionMachine } from "../../lib/session-machines";
import { useAgentAvatarSrc } from "../../lib/agent-avatar";
import { useProject } from "../../state/project";
import { useSessions } from "../../state/sessions";
import {
  extractTopology,
  extractTopologyForChild,
  modelAtOrigin,
  resolveAgentLabel,
  shortSessionId,
  type TopologyNode,
} from "./agent-topology";

import { useChildSessions, useChildTranscript } from "./use-child-sessions";
import { AgentTopologyView } from "./agent-topology-view";
import { MessageStream, type StreamRenderContext } from "./message-stream";
import { useAgentSkills } from "./use-agent-skills";
import type { ComposerReference } from "../../lib/workspace-tree";
import { toastApiError } from "../../lib/toast-api-error";

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
  connection = 0,
  models,
  approvalMode,
  approvalModes,
  onChangePermission,
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
  connection?: number;
  /** Project model list (the child composer's locked-model badge and context-window lookup). */
  models: ModelInfo[];
  /** The PARENT session's approval mode — child approvals are judged by it (the same value the main composer edits). */
  approvalMode: ApprovalMode;
  /** The approval modes the picker may offer for the PARENT session (the main composer's list). */
  approvalModes: readonly ApprovalMode[];
  /** Edits the PARENT session's approval mode and sandbox policy — a child runs under its root's. */
  onChangePermission: (pick: PermissionPick) => void | Promise<unknown>;
  modeSaving: boolean;
  /** The parent session's effective thinking level ("" = unknown): the child composer's display fallback — a child inherits it at spawn unless the spawning call pinned its own. */
  parentThinkingLevel: string;
}) {
  const { agents, setCurrentAgentId } = useProject();
  const avatarSrc = useAgentAvatarSrc();
  const { sessions } = useSessions();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Selection | null>(null);
  // The selected child's composer, for the stream above it: "Add to conversation" in the
  // child's selection menu stages the excerpt there, in the conversation it was selected in.
  const childComposerRef = useRef<ComposerControl | null>(null);
  const addChildExcerpt = useCallback((reference: ComposerReference) => {
    childComposerRef.current?.addReference(reference);
  }, []);

  const [anchor, setAnchor] = useState<string | null>(taskScope?.anchorSessionId ?? null);
  // A chip click focuses that child (fresh-object identity: re-clicking the same chip re-fires).
  useEffect(() => {
    if (focusRequest) {
      setAnchor(focusRequest.origin[0] ?? focusRequest.sessionId);
      setSelected({ sessionId: focusRequest.sessionId, origin: focusRequest.origin });
    }
  }, [focusRequest]);

  // Structural child liveness from the server (session id → running): the topology consults
  // it before its text heuristics, so revived and panel-started rounds read correctly.
  const liveStates = useMemo(
    () => new Map(subagents.map((s) => [s.sessionId, s.running])),
    [subagents],
  );

  const latest = useMemo(
    () => extractTopology(model, session.sessionId, taskRunning, liveStates),
    [model, version, session.sessionId, taskRunning, liveStates],
  );
  const change = JSON.stringify([
    ...latest.filter((node) => node.depth === 1).map((node) => node.sessionId),
    ...subagents.map((s) => `${s.sessionId}:${s.running}`),
    taskRunning,
  ]);
  const machine = machineForSession(session.sessionId);
  const history = useChildSessions(session.sessionId, machine, change, connection, anchor);
  const index = anchor
    ? history.turns.findIndex((turn) => turn.some((child) => child.sessionId === anchor))
    : 0;
  const turn = history.turns[index];
  const liveAnchor = latest.find(
    (node) => node.depth === 1 && liveStates.has(node.sessionId),
  )?.sessionId;
  const pendingLive =
    !!liveAnchor &&
    !history.turns.some((group) => group.some((child) => child.sessionId === liveAnchor));
  const nodes = useMemo(() => {
    const lookup = anchor ?? (pendingLive ? liveAnchor : turn?.[0]?.sessionId);
    const graph = lookup
      ? extractTopologyForChild(model, session.sessionId, taskRunning, lookup, liveStates)
      : null;
    if (!turn || (!anchor && pendingLive)) {
      // A fork retains the source conversation's transcript, including its delegation chips.
      // Only this parent runtime or its durable index may identify a child in the panel.
      const candidate = graph ?? latest;
      return candidate.filter((node) => node.depth === 0 || liveStates.has(node.origin[0]!));
    }
    const root = graph?.[0] ?? { ...latest[0]!, running: index === 0 && taskRunning };
    const result = [root];
    const ids = new Set(turn.map((child) => child.sessionId));
    // A stored historical turn can be wholly outside the parent's current transcript window.
    const detailed =
      graph ??
      turn
        .map((child) =>
          model.subagents.has(child.sessionId)
            ? extractTopologyForChild(
                model,
                session.sessionId,
                taskRunning,
                child.sessionId,
                liveStates,
              )
            : null,
        )
        .find(Boolean);
    for (const node of detailed?.slice(1) ?? []) {
      if (ids.has(node.origin[0]!) || (!anchor && index === 0 && liveStates.has(node.origin[0]!))) {
        result.push(node);
      }
    }
    const visible = new Set(result.map((node) => node.sessionId));
    for (const child of turn) {
      if (!visible.has(child.sessionId))
        result.push({
          sessionId: child.sessionId,
          agentId: child.agentId,
          description: child.title,
          origin: [child.sessionId],
          parentId: session.sessionId,
          spawnThinkingLevel: null,
          depth: 1,
          running: liveStates.get(child.sessionId) ?? false,
          startedMs: Date.parse(child.spawnedAt),
        });
    }
    return result;
  }, [
    model,
    latest,
    liveAnchor,
    anchor,
    pendingLive,
    turn,
    index,
    session.sessionId,
    taskRunning,
    liveStates,
  ]);
  const chooseTurn = (i: number) => {
    const target = history.turns[i]?.[0];
    if (!target) return;
    setSelected(null);
    setAnchor(i === 0 ? null : target.sessionId);
  };

  // No explicit selection yet: auto-focus the displayed Task's first child (null when none spawned).
  const firstChild = nodes.find((n) => n.depth > 0) ?? null;
  const active: Selection | null =
    (selected && nodes.some((node) => node.sessionId === selected.sessionId) ? selected : null) ??
    (firstChild ? { sessionId: firstChild.sessionId, origin: firstChild.origin } : null);

  const labelFor = (node: TopologyNode): string => {
    if (node.depth === 0) {
      const agent = agents.find((a) => a.agentId === session.agentId);
      // Same empty-name rule as resolveAgentLabel: an empty display name falls back to the id.
      return agent ? (agent.name?.length ? agent.name : agent.agentId) : session.agentId;
    }
    // Last-resort label is the short session id, not a generic word: two unknown children must stay distinguishable in the graph.
    return (
      resolveAgentLabel(node, agents, sessions) ??
      node.description ??
      shortSessionId(node.sessionId)
    );
  };
  /** A node's Agent's own picture, the Agent found as the label finds it (the root is this Session's). */
  const avatarFor = (node: TopologyNode): string | undefined => {
    const agentId =
      node.depth === 0
        ? session.agentId
        : (node.agentId ?? sessions.find((s) => s.sessionId === node.sessionId)?.agentId);
    return agentId === undefined ? undefined : avatarSrc(agentId, machine);
  };

  const isRoot = active !== null && active.origin.length === 0;
  const activeNode = active ? (nodes.find((n) => n.sessionId === active.sessionId) ?? null) : null;
  const embedded = active && !isRoot ? modelAtOrigin(model, active.origin) : null;
  const childRead = useChildTranscript(
    active && !isRoot && !embedded ? active.sessionId : null,
    machine,
  );
  const activeModel = embedded ?? childRead?.model ?? null;
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
    rememberSessionMachine(active.sessionId, machine);
    const agentId = row?.agentId ?? activeModel?.meta?.agentId ?? activeNode?.agentId ?? null;
    if (agentId !== null) setCurrentAgentId(agentId);
    navigate(`/chat/${active.sessionId}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Call graph of the displayed Task — latest by default, a chip's Task when pinned. */}
      <div className="shrink-0 border-b border-gray-200 px-3 pb-2 pt-1.5 dark:border-gray-800">
        <AgentTopologyView
          nodes={nodes}
          selectedId={active?.sessionId ?? null}
          labelFor={labelFor}
          avatarFor={avatarFor}
          onSelect={(node) => setSelected({ sessionId: node.sessionId, origin: node.origin })}
          pager={
            history.turns.length > 1 && index >= 0 ? (
              <Pager
                className="shrink-0"
                page={history.turns.length - 1 - index}
                pageCount={history.turns.length}
                previousLabel={S.subagentPanel.previousTurn}
                nextLabel={S.subagentPanel.nextTurn}
                lastPageLabel={S.subagentPanel.latestTurn}
                readout={S.subagentPanel.page(history.turns.length - index)}
                onChange={(next) => chooseTurn(history.turns.length - 1 - next)}
              />
            ) : null
          }
          notice={
            history.error ? (
              <div role="status" className="mb-1.5 text-xs text-fg-muted">
                {history.error}{" "}
                <button type="button" onClick={history.retry}>
                  {S.common.retry}
                </button>
              </div>
            ) : null
          }
        />
      </div>

      {/* Selected conversation (or the root note / empty state). */}
      {active === null ? (
        <div className="min-h-0 flex-1">
          <EmptyState title={history.busy ? S.common.loading : S.subagentPanel.empty} />
        </div>
      ) : isRoot ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <p className="text-sm text-gray-400 dark:text-gray-500">
            {S.subagentPanel.mainSessionNote}
          </p>
        </div>
      ) : (
        <>
          {/* Slim identity strip for the conversation below. The spawning call's description
              belongs to its node in the graph above, not here — one line, one place. */}
          <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-3 py-1.5 dark:border-gray-800/60">
            <AgentAvatar
              id={activeModel?.meta?.agentId ?? activeNode?.agentId ?? active.sessionId}
              size={16}
              src={avatarSrc(activeModel?.meta?.agentId ?? activeNode?.agentId ?? "", machine)}
            />
            <span className="min-w-0 truncate text-xs font-semibold text-gray-700 dark:text-gray-300">
              {activeLabel}
            </span>
            <span
              data-tooltip={active.sessionId}
              data-tooltip-extra
              className="shrink-0 font-mono text-xs text-fg-subtle"
            >
              {shortSessionId(active.sessionId)}
            </span>
            <CopyButton text={active.sessionId} label={S.chat.copySessionId} size="sm" />
            {activeRunning && (
              <StatusIcon state="running" size="xs" label={S.chat.subagentRunning} />
            )}
            <span className="min-w-0 flex-1" />
            {/* Jump out of the panel: the child conversation as a full Session. */}
            <button
              type="button"
              data-tooltip={S.subagentPanel.openAsSession}
              aria-label={S.subagentPanel.openAsSession}
              data-testid="subagent-open-session"
              onClick={openAsSession}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
            >
              <GlyphIcon d={ICONS.boxArrowOut} size={ICON_SIZE.rowLead} />
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {/* Keyed by child: switching nodes resets scroll-follow instead of carrying the old position over. */}
            {activeModel && childCtx ? (
              <MessageStream
                key={active.sessionId}
                items={activeModel.items}
                version={embedded ? (embedded.lastActivityLocalMs ?? embedded.items.length) : 0}
                ctx={childCtx}
                onAddExcerpt={addChildExcerpt}
                findRegion="subagent"
              />
            ) : (
              <EmptyState title={childRead?.error ?? S.common.loading} />
            )}
          </div>
          {/* Keyed by child too: switching nodes must not carry a half-typed message over. */}
          {activeModel && (
            <SubagentComposer
              key={`composer-${active.sessionId}`}
              controlRef={childComposerRef}
              sessionId={session.sessionId}
              childSessionId={active.sessionId}
              running={activeRunning}
              meta={activeModel.meta}
              contextNow={activeModel.stats.contextNow}
              deliveredInputs={countDeliveredInputs(activeModel)}
              models={models}
              approvalMode={approvalMode}
              approvalModes={approvalModes}
              sandbox={session.sandbox}
              onChangePermission={onChangePermission}
              modeSaving={modeSaving}
              fallbackThinkingLevel={activeNode?.spawnThinkingLevel ?? parentThinkingLevel}
            />
          )}
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
  controlRef,
  sessionId,
  childSessionId,
  running,
  meta,
  contextNow,
  deliveredInputs,
  models,
  approvalMode,
  approvalModes,
  sandbox,
  onChangePermission,
  modeSaving,
  fallbackThinkingLevel,
}: {
  /** Handed to the ChatInput: the child stream's selection menu stages excerpts through it. */
  controlRef: RefObject<ComposerControl | null>;
  sessionId: string;
  childSessionId: string;
  running: boolean;
  meta: NestedSessionMeta | null;
  contextNow: number;
  deliveredInputs: number;
  models: ModelInfo[];
  approvalMode: ApprovalMode;
  approvalModes: readonly ApprovalMode[];
  /** The PARENT session's sandbox policy. */
  sandbox: SessionSandbox;
  /** Edits the PARENT session's approval mode and sandbox policy — a child runs under its root's. */
  onChangePermission: (pick: PermissionPick) => void | Promise<unknown>;
  modeSaving: boolean;
  /** Display fallback for the thinking picker while the user hasn't picked: the spawn call's explicit level, else the parent session's effective level (what the child inherited). */
  fallbackThinkingLevel: string;
}) {
  const { currentProject } = useProject();
  const projectId = currentProject?.projectId ?? null;
  // Skills of the CHILD's agent (it may differ from the parent's): candidates for the
  // toolbar dropdown and the slash menu. A child shares its parent's Workspace, so its Agent
  // is the one on the parent Session's machine.
  const { skills } = useAgentSkills(projectId, meta?.agentId ?? null, machineForSession(sessionId));

  // The level pinned on the child Session from this panel ("" = untouched, the child runs at
  // its own level): mirrors the main composer's per-session pick, scoped to this child —
  // written through PATCH on the child; core applies it from the child's next LLM request.
  const [turnLevel, setTurnLevel] = useState("");
  const pinChildLevel = (level: string): void => {
    setTurnLevel(level);
    void patchSession(
      childSessionId,
      {
        thinkingLevel: level as SessionPatchRequest["thinkingLevel"],
      },
      machineForSession(sessionId),
    ).catch((err: unknown) => toastApiError(err));
  };

  const modelRef = meta ? { provider: meta.provider, modelId: meta.modelId } : null;
  const contextWindow = modelRef
    ? models.find((m) => m.provider === modelRef.provider && m.modelId === modelRef.modelId)
        ?.contextWindow
    : undefined;

  const send = (text: string) => messageSubagent(sessionId, childSessionId, text);
  const sendFailure = (err: unknown): void => {
    toastApiError(err, {
      text:
        err instanceof ApiError && err.code === "subagent_gone"
          ? S.subagentPanel.subagentGone
          : err instanceof Error
            ? err.message
            : String(err),
    });
  };

  return (
    <div className="shrink-0 border-t border-gray-100 px-2 pb-2 pt-2 dark:border-gray-800/60">
      {/* The transcript's reading column (MessageStream caps its messages at max-w-3xl), as the
          main conversation's composer does: a dock at full screen is as wide as the chat column
          or wider, and the composer must line up with the messages above it rather than span
          the surface. A docked panel is narrower than the cap, so there it changes nothing. */}
      <div className="mx-auto max-w-3xl">
        <ChatInput
          variant="subagent"
          controlRef={controlRef}
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
          // (spawn-pinned level, else the parent's effective level it inherited). A pick is
          // PATCHed onto the child Session and applies from its next LLM request.
          turnThinkingLevel={turnLevel || fallbackThinkingLevel}
          onChangeTurnThinkingLevel={pinChildLevel}
          {...(contextWindow !== undefined ? { contextWindow } : {})}
          contextNow={contextNow}
          vision={false}
          approvalMode={approvalMode}
          approvalModes={approvalModes}
          sandbox={sandbox}
          onChangePermission={onChangePermission}
          modeSaving={modeSaving}
          agents={[]}
          skills={skills}
        />
      </div>
    </div>
  );
}
