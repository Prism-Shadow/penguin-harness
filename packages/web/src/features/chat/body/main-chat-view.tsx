import { sessionActivity, sessionBackgroundTasks } from "../../../lib/session-activity";
import { bucketCostUsd } from "../../../lib/omni/task-stats";
import { agentDisplayName } from "../../../state/project";
import { modelTaskStartCount } from "../agent-topology";
import { ChatInput } from "../chat-input";
import { approvalModeChoices } from "../approval-mode";
import { sessionThinkingLevel } from "../../model-picker";
import { advanceCostStat } from "../header-stats";
import { sameModelRef } from "../../models";
import { headerStats } from "../session/main-chat-helpers";
import type { useChatController } from "../session/use-chat-controller";
import { agentPagePath } from "../session/main-chat-dock";
import { machineForSession } from "../../../lib/session-machines";

export function createMainChatView(
  scope: ReturnType<typeof useChatController> & { projectId: string; pageAgentId: string | null },
) {
  const {
    navigate,
    currency,
    agents,
    projectId,
    costHoldRef,
    modeSaving,
    models,
    usageBuckets,
    selected,
    pageAgentId,
    activeModelRef,
    stream,
    sessionDraft,
    onDraftTextChange,
    onDraftHandoffChange,
    onDraftPendingModelChange,
    onDraftSkillsChange,
    inputHistory,
    turnThinkingLevel,
    agentSkills,
    agentThinkingLevel,
    compactionLimit,
    onChangeCompactionLimit,
    onSend,
    onSwitchModel,
    onHandoff,
    onStop,
    onQueueFollowUp,
    onSteer,
    composerRef,
    onRecallSteering,
    onRecallFollowUp,
    onChangePermission,
    onCompact,
    onPickTurnThinkingLevel,
    onPickSessionModel,
    modelPricing,
  } = scope;

  // Header statistics (chip row + info dropdown), live while a Task runs; recomputed every
  // stream version bump, so the in-place-mutated model stats always read fresh. The cost chip
  // advances its per-session hold with this render's observation (idempotent per observation,
  // so a replayed render converges — see header-stats.ts).
  const liveTaskUsd = stream.model.taskOpen
    ? bucketCostUsd(
        {
          cacheRead: stream.model.stats.taskCacheRead,
          cacheWrite: stream.model.stats.taskCacheWrite,
          output: stream.model.stats.taskOutput,
        },
        modelPricing,
      )
    : null;
  const hs = headerStats(
    stream.model,
    advanceCostStat(costHoldRef.current, {
      sessionId: selected?.sessionId ?? null,
      // The cost tracker's Task boundary is the MODEL's, not the panel's: a completion notice
      // opens a new Task (zeroing the per-Task usage buckets) even though the panel keeps it
      // inside the launching Task's scope, so it must be counted here or the finished half's
      // live cost is dropped instead of folded.
      taskCount: modelTaskStartCount(stream.model.items),
      taskOpen: stream.model.taskOpen,
      loading: stream.loading,
      liveUsd: liveTaskUsd,
      currency,
    }),
  );
  // Cache hit rate over the recorded input buckets (cacheRead = hits, cacheWrite =
  // uncached input) — the details card's tokens-line parenthetical. Null until a usage
  // row with any input has applied, so a fresh session shows no "0%" out of thin air.
  const recordedInput = usageBuckets ? usageBuckets.cacheRead + usageBuckets.cacheWrite : 0;
  const cacheHitRate =
    usageBuckets && recordedInput > 0
      ? `${Math.round((100 * usageBuckets.cacheRead) / recordedInput)}%`
      : null;
  // Display name of the Session's own Agent for the details card — null when the Agent has
  // no name of its own (agentDisplayName then returns the id, which the row already shows)
  // or when the Agent list hasn't arrived yet.
  const sessionAgent = agents.find((a) => a.agentId === selected?.agentId);
  const sessionAgentName =
    sessionAgent && sessionAgent.name !== undefined ? agentDisplayName(sessionAgent) : null;
  const modelInfo = models?.models.find((m) => sameModelRef(m, activeModelRef));
  const contextWindow = modelInfo?.contextWindow;
  // Assumed supported by default: only models explicitly marked vision=false show a blocking hint when adding images.
  const vision = modelInfo?.vision !== false;
  const emptyChat =
    selected !== null && !stream.loading && !stream.error && stream.model.items.length === 0;

  // Input area in session state: Agent and Workspace are fixed by the Session. The toolbar's
  // model picker switches this conversation's model in place (confirmed, compacting first);
  // approval mode and the thinking level stay editable; /model opens a NEW conversation on
  // another model and leaves this one as it is.
  const input = selected && (
    <ChatInput
      controlRef={composerRef}
      status={stream.taskState}
      onSend={onSend}
      onSteer={onSteer}
      // Count of steering messages already visible in the stream: the input area keeps its
      // "queued" indicator up until this count increases (i.e. the steering message arrived).
      steeringDeliveredCount={stream.model.items.filter((i) => i.kind === "user_steering").length}
      pendingSteering={stream.pendingSteering}
      returnedSteering={stream.returnedSteering}
      onRecallSteering={onRecallSteering}
      onQueueFollowUp={onQueueFollowUp}
      queuedFollowUps={stream.queuedFollowUps}
      pendingFollowUps={stream.pendingFollowUps}
      onRecallFollowUp={onRecallFollowUp}
      onStop={onStop}
      onCompact={onCompact}
      modelRef={activeModelRef}
      {...(models !== null ? { models: models.models } : {})}
      {...(models?.defaultModel !== undefined ? { defaultModel: models.defaultModel } : {})}
      onSwitchModel={onSwitchModel}
      onPickSessionModel={onPickSessionModel}
      // Display value: the level pinned on this Session, else the Agent config's level
      // (auto-follow while unpinned; the send path uses the raw pin — see onSend).
      turnThinkingLevel={sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel)}
      // Guarded: a mid-chat change stages behind the prefix-cache confirm dialog (issue #310).
      onChangeTurnThinkingLevel={onPickTurnThinkingLevel}
      {...(contextWindow !== undefined ? { contextWindow } : {})}
      {...(compactionLimit !== undefined ? { compactionLimit } : {})}
      onChangeCompactionLimit={onChangeCompactionLimit}
      onOpenAgentSettings={() =>
        navigate(agentPagePath(selected.agentId, machineForSession(selected.sessionId), "runtime"))
      }
      contextNow={stream.model.stats.contextNow}
      contextStale={stream.model.stats.contextStale}
      sessionId={selected.sessionId}
      vision={vision}
      approvalMode={selected.approvalMode}
      // An organization's Session is not offered always-ask: nobody is there to be asked.
      approvalModes={approvalModeChoices(selected.client, selected.approvalMode)}
      sandbox={selected.sandbox}
      onChangePermission={onChangePermission}
      modeSaving={modeSaving}
      autoFocus
      agents={agents}
      currentAgentId={selected.agentId}
      skills={agentSkills}
      {...(sessionDraft.skills && sessionDraft.skills.length > 0
        ? { initialSkills: sessionDraft.skills }
        : {})}
      onSkillsChange={onDraftSkillsChange}
      onHandoff={onHandoff}
      initialText={sessionDraft.text ?? ""}
      onTextChange={onDraftTextChange}
      history={inputHistory}
      {...(sessionDraft.handoffAgentId
        ? { initialHandoffTargetId: sessionDraft.handoffAgentId }
        : {})}
      onHandoffTargetChange={onDraftHandoffChange}
      {...(sessionDraft.switchModelRef
        ? { initialPendingModelRef: sessionDraft.switchModelRef }
        : {})}
      onPendingModelChange={onDraftPendingModelChange}
    />
  );

  /**
   * Header glyph state. Never unread: this is the Session on screen, so its last reply is being
   * read right now — the read/unread split is a sidebar affordance, and passing the live marker
   * here would only flash the unread tone for the frame before the effect above stamps it.
   */
  const headerActivity =
    selected === null ? null : sessionActivity(stream.taskState, selected.hasTrace, false);
  /** Background tasks the conversation still owns — the same live count the sidebar row's mark carries. */
  const backgroundCount = selected === null ? 0 : sessionBackgroundTasks(selected);
  return {
    ...scope,
    liveTaskUsd,
    hs,
    recordedInput,
    cacheHitRate,
    sessionAgent,
    sessionAgentName,
    modelInfo,
    contextWindow,
    vision,
    emptyChat,
    input,
    headerActivity,
    backgroundCount,
  };
}
export type MainChatView = ReturnType<typeof createMainChatView>;
