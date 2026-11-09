import { Button, ConfirmModal, Modal } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { thinkingLevelLabel } from "../../model-picker";
import type { MainChatView } from "../body/main-chat-view";

export function renderMainChatDialogs(scope: MainChatView) {
  const {
    navigate,
    credentialGuide,
    setCredentialGuide,
    procToKill,
    setProcToKill,
    thinkingSwitch,
    setThinkingSwitch,
    modelSwitchAsk,
    setModelSwitchAsk,
    modelSwitchPosting,
    selected,
    stream,
    onKillProcess,
    applyTurnThinkingLevel,
    compactThenThinkingSwitch,
    modelDisplay,
    confirmModelSwitch,
  } = scope;
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
