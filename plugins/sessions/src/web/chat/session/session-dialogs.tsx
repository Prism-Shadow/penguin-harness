/**
 * The chat page's dialogs: the once-per-lifetime credential guide, the confirmation before a
 * background process is stopped, and the two confirmations a mid-conversation switch waits
 * behind — the thinking level (issue #310) and the model.
 */
import type { NavigateFunction } from "react-router";
import type {
  ModelRefDto,
  SessionInfo,
  SessionProcessInfo,
  SessionStatus,
} from "@prismshadow/penguin-server/api";
import { Button, ConfirmModal, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { thinkingLevelLabel, type StagedThinkingSwitch } from "../../model-picker";

import type { SwitchContextShape } from "../model-switch";

/** What the dialogs read off the conversation's controller. */
export interface SessionDialogsSession {
  navigate: NavigateFunction;
  /** The running process whose Stop awaits confirmation: stopping kills it outright. */
  procToKill: SessionProcessInfo | null;
  setProcToKill: (next: SessionProcessInfo | null) => void;
  onKillProcess: (processId: string) => Promise<void>;
  selected: SessionInfo | null;
  stream: { taskState: SessionStatus };
  credentialGuide: boolean;
  setCredentialGuide: (open: boolean) => void;
  thinkingSwitch: StagedThinkingSwitch | null;
  setThinkingSwitch: (next: StagedThinkingSwitch | null) => void;
  compactThenThinkingSwitch: () => void;
  applyTurnThinkingLevel: (level: string) => void;
  modelSwitchAsk: { to: ModelRefDto; shape: SwitchContextShape } | null;
  setModelSwitchAsk: (next: null) => void;
  modelSwitchPosting: boolean;
  confirmModelSwitch: () => Promise<void>;
  modelDisplay: (ref: ModelRefDto) => string;
}

export function SessionDialogs({ session }: { session: SessionDialogsSession }) {
  const {
    navigate,
    procToKill,
    setProcToKill,
    onKillProcess,
    selected,
    stream,
    credentialGuide,
    setCredentialGuide,
    thinkingSwitch,
    setThinkingSwitch,
    compactThenThinkingSwitch,
    applyTurnThinkingLevel,
    modelSwitchAsk,
    setModelSwitchAsk,
    modelSwitchPosting,
    confirmModelSwitch,
    modelDisplay,
  } = session;
  return (
    <>
      <Modal
        open={credentialGuide}
        title={S.project.noCredentialTitle}
        onClose={() => setCredentialGuide(false)}
        footer={
          <>
            <Button size="sm" onClick={() => setCredentialGuide(false)}>
              {S.project.later}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setCredentialGuide(false);
                navigate("/models");
              }}
            >
              {S.project.goToModels}
            </Button>
          </>
        }
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.project.noCredentialBody}</p>
      </Modal>

      <ConfirmModal
        open={procToKill !== null}
        title={S.chat.processStopTitle}
        onClose={() => setProcToKill(null)}
        onConfirm={() => {
          if (procToKill !== null) void onKillProcess(procToKill.processId);
          setProcToKill(null);
        }}
        confirmLabel={S.chat.processStop}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.chat.processStopConfirm}</p>
        <p className="mt-2 line-clamp-3 break-all font-mono text-xs text-gray-500 dark:text-gray-400">
          {procToKill?.cmd}
        </p>
      </ConfirmModal>

      {/* Mid-chat thinking-level switch confirmation (issue #310), three choices: compact
            first and switch when it finishes (primary — the recommended, cheap path), switch
            anyway (immediate, today's force path), or cancel (keeps the current level). The
            compact choice is unavailable while the session is busy — the server only starts a
            compaction on an idle session and does not queue it — and the body then says so.
            After a successful compaction the guard lets a re-pick through without asking. */}
      <ConfirmModal
        open={thinkingSwitch?.phase === "ask"}
        title={S.chat.thinkingSwitchTitle}
        tone="primary"
        confirmLabel={S.chat.thinkingSwitchCompactFirst}
        cancelLabel={S.common.cancel}
        confirmDisabled={stream.taskState !== "idle"}
        onConfirm={compactThenThinkingSwitch}
        secondaryLabel={S.chat.thinkingSwitchConfirm}
        onSecondary={() => {
          if (thinkingSwitch !== null) applyTurnThinkingLevel(thinkingSwitch.level);
          setThinkingSwitch(null);
        }}
        onClose={() => setThinkingSwitch(null)}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.chat.thinkingSwitchBody(
            thinkingLevelLabel(S.chat.thinkingLevelNames, thinkingSwitch?.level) ??
              thinkingSwitch?.level ??
              "",
          )}
        </p>
        {stream.taskState !== "idle" && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {S.chat.thinkingSwitchBusyHint}
          </p>
        )}
      </ConfirmModal>

      {/* In-conversation model switch confirmation (the session toolbar's model picker), two
            choices only: compact and switch, or cancel. There is no "switch anyway" — a switch
            always compacts on the current model first, and a failed compaction keeps it. The two
            shapes with nothing to compact read "switch" instead: an empty transcript (the switch
            is immediate) and a transcript ending in a completed compaction or a model switch (no
            compaction runs; the conversation continues from what is already held). The session
            can start running while the dialog is up (a queued follow-up, a schedule): the confirm
            is then disabled and the body says why, exactly like the thinking dialog. */}
      <ConfirmModal
        open={modelSwitchAsk !== null}
        title={S.chat.modelSwitchInSessionTitle}
        tone="primary"
        confirmLabel={
          modelSwitchAsk?.shape === "compact"
            ? S.chat.modelSwitchInSessionConfirm
            : S.chat.modelSwitchInSessionDirectConfirm
        }
        cancelLabel={S.common.cancel}
        confirmDisabled={stream.taskState !== "idle"}
        busy={modelSwitchPosting}
        onConfirm={() => void confirmModelSwitch()}
        onClose={() => {
          if (!modelSwitchPosting) setModelSwitchAsk(null);
        }}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {modelSwitchAsk === null || selected === null
            ? null
            : modelSwitchAsk.shape === "empty"
              ? S.chat.modelSwitchInSessionDirectBody(modelDisplay(modelSwitchAsk.to))
              : modelSwitchAsk.shape === "compacted"
                ? S.chat.modelSwitchInSessionCompactedBody(modelDisplay(modelSwitchAsk.to))
                : S.chat.modelSwitchInSessionBody(
                    modelDisplay({ provider: selected.provider, modelId: selected.modelId }),
                    modelDisplay(modelSwitchAsk.to),
                  )}
        </p>
        {stream.taskState !== "idle" && (
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {S.chat.thinkingSwitchBusyHint}
          </p>
        )}
      </ConfirmModal>
    </>
  );
}
