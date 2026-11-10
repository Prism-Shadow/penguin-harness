/**
 * The composer of an open conversation. Agent and Workspace are fixed by the Session; the
 * toolbar's model picker switches this conversation's model in place (confirmed, compacting
 * first); approval mode and the thinking level stay editable; /model opens a NEW conversation on
 * another model and leaves this one as it is.
 */
import type { ComponentProps, RefObject } from "react";
import type { NavigateFunction } from "react-router";
import type {
  AgentSummary,
  ModelRefDto,
  ModelsResponse,
  SessionInfo,
  SkillMetadataItem,
} from "@prismshadow/penguin-server/api";
import { sameModelRef } from "../../models";
import { sessionThinkingLevel } from "../../model-picker";
import { ChatInput, type ComposerControl } from "../chat-input";

import { approvalModeChoices } from "../approval-mode";
import { agentPagePath } from "../session/main-chat-dock";
import { machineForSession } from "../../../lib/session-machines";
import type { DraftCache } from "../draft-cache";
import type { SessionStreamState } from "../use-session-stream";

type ChatInputProps = ComponentProps<typeof ChatInput>;

/** What the composer reads off the conversation's controller. */
export interface SessionComposerSession {
  navigate: NavigateFunction;
  composerRef: RefObject<ComposerControl | null>;
  stream: SessionStreamState;
  models: ModelsResponse | null;
  activeModelRef: ModelRefDto | null;
  agents: AgentSummary[];
  agentSkills: SkillMetadataItem[];
  /** The thinking level pinned on the Session ("" = never pinned). */
  turnThinkingLevel: string;
  /** The Agent config's thinking level ("" = unset or loading). */
  agentThinkingLevel: string;
  compactionLimit: number | undefined;
  modeSaving: boolean;
  sessionDraft: DraftCache;
  inputHistory: ChatInputProps["history"];
  onSend: ChatInputProps["onSend"];
  onSteer: ChatInputProps["onSteer"];
  onRecallSteering: ChatInputProps["onRecallSteering"];
  onQueueFollowUp: ChatInputProps["onQueueFollowUp"];
  onRecallFollowUp: ChatInputProps["onRecallFollowUp"];
  onStop: ChatInputProps["onStop"];
  onCompact: ChatInputProps["onCompact"];
  onSwitchModel: ChatInputProps["onSwitchModel"];
  onPickSessionModel: ChatInputProps["onPickSessionModel"];
  onPickTurnThinkingLevel: ChatInputProps["onChangeTurnThinkingLevel"];
  onChangeCompactionLimit: ChatInputProps["onChangeCompactionLimit"];
  onChangePermission: ChatInputProps["onChangePermission"];
  onHandoff: ChatInputProps["onHandoff"];
  onDraftSkillsChange: ChatInputProps["onSkillsChange"];
  onDraftTextChange: ChatInputProps["onTextChange"];
  onDraftHandoffChange: ChatInputProps["onHandoffTargetChange"];
  onDraftPendingModelChange: ChatInputProps["onPendingModelChange"];
}

export function SessionComposer({
  session,
  selected,
}: {
  session: SessionComposerSession;
  selected: SessionInfo;
}) {
  const {
    navigate,
    composerRef,
    stream,
    models,
    activeModelRef,
    agents,
    agentSkills,
    turnThinkingLevel,
    agentThinkingLevel,
    compactionLimit,
    modeSaving,
    sessionDraft,
    inputHistory,
    onSend,
    onSteer,
    onRecallSteering,
    onQueueFollowUp,
    onRecallFollowUp,
    onStop,
    onCompact,
    onSwitchModel,
    onPickSessionModel,
    onPickTurnThinkingLevel,
    onChangeCompactionLimit,
    onChangePermission,
    onHandoff,
    onDraftSkillsChange,
    onDraftTextChange,
    onDraftHandoffChange,
    onDraftPendingModelChange,
  } = session;
  const modelInfo = models?.models.find((m) => sameModelRef(m, activeModelRef));
  const contextWindow = modelInfo?.contextWindow;
  // Assumed supported by default: only models explicitly marked vision=false show a blocking hint when adding images.
  const vision = modelInfo?.vision !== false;
  return (
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
}
