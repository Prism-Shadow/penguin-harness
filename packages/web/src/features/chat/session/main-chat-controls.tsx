import { useCallback, useEffect } from "react";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { toastError, toastInfo, toastSuccess } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { onPluginConfigSaved } from "../../../lib/plugin-config-event";
import {
  compactionTally,
  heldThinkingSwitch,
  modelLabel,
  needsThinkingSwitchConfirm,
  sessionThinkingLevel,
  thinkingLevelLabel,
  type StagedThinkingSwitch,
} from "../../model-picker";

import { sessionModelPickerDisabled, sessionRowStale, switchContextShape } from "../model-switch";
import { sameModelRef } from "../../models";
import type { useMainChatComposer } from "./main-chat-composer";

/** Exact consecutive main ChatPage statements 148..158; called once, in original order. */
export function useMainChatControls(scope: ReturnType<typeof useMainChatComposer>) {
  const {
    replace,
    models,
    thinkingSwitch,
    setThinkingSwitch,
    modelSwitchAsk,
    setModelSwitchAsk,
    modelSwitchPosting,
    setModelSwitchPosting,
    selected,
    stream,
    turnThinkingLevel,
    agentThinkingLevel,
    syncHealedSessionId,
    applySessionRow,
    applyTurnThinkingLevel,
  } = scope;

  // The Sandbox card was saved: the open Session's view (switch, presets) is read again, so the
  // permission menu shows what the card now says.
  const selectedId = selected?.sessionId;
  useEffect(() => {
    if (selectedId === undefined) return;
    return onPluginConfigSaved("sandbox", () => {
      void api.getSession(selectedId).then(
        (res) => replace(res.session),
        () => undefined,
      );
    });
  }, [selectedId, replace]);

  // Starts a context compaction — the single path to the server for it (the composer's
  // /compact command and the thinking-switch dialog's "compact, then switch" both come
  // through here). Returns whether the request was ACCEPTED: the endpoint answers 202 and
  // the compaction itself runs asynchronously, so a true here means "started", not
  // "finished" — the outcome only shows up on the stream (see the staged-switch watcher).
  // false means the server refused it (409 while a task runs / nothing to compact / …) and
  // the reason has already been surfaced as a toast.
  const runCompaction = useCallback(async (): Promise<boolean> => {
    if (!selected) return false;
    try {
      // compact shares get-or-resume-or-heal with tasks: it can likewise self-heal to a new session_id.
      const res = await api.postCompact(selected.sessionId);
      await syncHealedSessionId(selected.sessionId, res.sessionId);
      return true;
    } catch (e) {
      toastError(apiErrorText(e, { modelId: selected.modelId }));
      return false;
    }
  }, [selected, syncHealedSessionId]);

  // The composer's /compact command: unchanged behavior (fire it, errors land as a toast).
  const onCompact = useCallback(async () => {
    await runCompaction();
  }, [runCompaction]);

  // Session picker pick: pinned directly while it cannot hurt (empty transcript, a re-pick
  // of the displayed level, or right after a successful compaction), staged behind the
  // confirm dialog otherwise — switching the level mid-chat costs prompt-cache hits over
  // the whole history (issue #310), so the dialog offers compact-then-switch (recommended),
  // switch anyway, or cancel. The transcript is always loaded when the picker is clickable
  // (the composer only mounts once history load settles), so the live tail items are
  // authoritative here.
  const onPickTurnThinkingLevel = useCallback(
    (level: string) => {
      if (
        needsThinkingSwitchConfirm(
          stream.model.items,
          sessionThinkingLevel(turnThinkingLevel, agentThinkingLevel),
          level,
        )
      ) {
        setThinkingSwitch({ phase: "ask", level });
      } else {
        applyTurnThinkingLevel(level);
      }
    },
    [stream.model, turnThinkingLevel, agentThinkingLevel, applyTurnThinkingLevel],
  );

  // Dialog choice 1 (recommended): compact first, then switch. The compaction is only
  // STARTED here — POST /compact answers 202 — so the pick is held with a tally of the
  // compactions already on record, and the watcher below releases it once a new one ends
  // (either way it ends). Compaction cannot be started (nor queued) while the session is
  // busy, so the dialog disables this choice unless idle; the guard here is the same rule.
  const compactThenThinkingSwitch = useCallback(() => {
    if (thinkingSwitch === null || stream.taskState !== "idle") return;
    const staged: StagedThinkingSwitch = {
      phase: "compacting",
      level: thinkingSwitch.level,
      baseline: compactionTally(stream.model.items),
    };
    setThinkingSwitch(staged);
    toastInfo(S.chat.thinkingSwitchCompacting);
    void runCompaction().then((ok) => {
      // Refused (the toast already said why, e.g. nothing to compact): no compaction will
      // ever settle, so hand the pick to the watcher below to release — the user asked to
      // switch, and only the compaction half of that failed. A pick staged meanwhile owns
      // the state instead.
      if (!ok) {
        setThinkingSwitch((cur) =>
          cur === staged ? { phase: "settle", level: staged.level } : cur,
        );
      }
    });
  }, [thinkingSwitch, stream.taskState, stream.model, runCompaction]);

  // Releases the pick held behind a running compaction: applied as soon as the compaction is
  // over, whichever way it ended. A failed/aborted compaction is reported (the context was
  // not rewritten, so this switch does cost cache hits) but never swallows the switch the
  // user asked for. Runs on every stream version bump because the model's items are mutated
  // in place.
  useEffect(() => {
    if (thinkingSwitch === null) return;
    const next = heldThinkingSwitch(thinkingSwitch, stream.model.items);
    if (next.act === "wait") return;
    setThinkingSwitch(null);
    applyTurnThinkingLevel(next.level);
    if (next.notice === "compacted") {
      toastSuccess(
        S.chat.thinkingSwitchApplied(
          thinkingLevelLabel(S.chat.thinkingLevelNames, next.level) ?? next.level,
        ),
      );
    } else if (next.notice === "compaction-failed") {
      toastError(S.chat.thinkingSwitchCompactFailed);
    }
    // notice "none": the compaction never started and runCompaction already said why.
    // The items are read from the model per run; `version` is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.version, stream.model, thinkingSwitch, applyTurnThinkingLevel]);

  /** A model's display label for the switch dialog and its toasts: the configured name, else the id. */
  const modelDisplay = useCallback(
    (ref: ModelRefDto): string => {
      const m = models?.models.find((x) => sameModelRef(x, ref));
      return m ? modelLabel(m) : ref.modelId;
    },
    [models],
  );

  // Session toolbar model picker: switches THIS conversation's model (the `/model` handoff opens
  // a new conversation instead). Re-picking the current model does nothing, and neither does a
  // pick that raced a Task starting (the picker is disabled then, and the server would refuse
  // it anyway); any other pick asks first, worded for what the switch will do: compact the
  // context on the current model before moving on, or — right after a compaction or a switch,
  // when there is nothing to compact — continue on the picked model from what is already held.
  const onPickSessionModel = useCallback(
    (ref: ModelRefDto) => {
      if (!selected || sameModelRef(ref, selected)) return;
      if (sessionModelPickerDisabled(stream.taskState)) return;
      // Read at pick time: the model's items mutate in place. The live tail decides, behind
      // whatever window was backfilled above it.
      const shape = switchContextShape([...stream.prefixItems, ...stream.model.items]);
      setModelSwitchAsk({ to: ref, shape });
    },
    [selected, stream.taskState, stream.prefixItems, stream.model],
  );

  // The dialog's confirm. 202 = the switch is streaming: the compaction row (or, right after a
  // compaction, the model-change marker alone) carries it from here, and the effect below moves
  // the Session row once the new context's session_meta names the new model. 200 = the Session
  // never ran and switched inside the request: the row comes back with the response — under a
  // new id when the server had to rebuild a Session that left no Trace, which the page follows.
  // A refusal (409 busy / same model / not configured / unavailable / compaction not configured)
  // is a toast.
  const confirmModelSwitch = useCallback(async () => {
    const ask = modelSwitchAsk;
    if (!selected || ask === null || modelSwitchPosting) return;
    setModelSwitchPosting(true);
    const from = modelDisplay({ provider: selected.provider, modelId: selected.modelId });
    const to = modelDisplay(ask.to);
    try {
      const res = await api.switchSessionModel(selected.sessionId, {
        provider: ask.to.provider,
        modelId: ask.to.modelId,
      });
      if ("session" in res) {
        applySessionRow(res.session);
        toastSuccess(S.chat.modelSwitchInSessionApplied(to));
        await syncHealedSessionId(selected.sessionId, res.session.sessionId);
        return;
      }
      // Only a switch that compacts may say so; one that continues from a held summary runs
      // no compaction and must not promise one.
      toastInfo(
        ask.shape === "compact"
          ? S.chat.modelSwitchInSessionStarted(from, to)
          : S.chat.modelSwitchInSessionSwitching(to),
      );
    } catch (e) {
      // The codes that take a model name are about the model the Session is on (its loader's
      // missing credential); a refusal of the target names it in its own message.
      toastError(apiErrorText(e, { modelId: selected.modelId }));
    } finally {
      setModelSwitchPosting(false);
      setModelSwitchAsk(null);
    }
  }, [
    modelSwitchAsk,
    modelSwitchPosting,
    selected,
    modelDisplay,
    applySessionRow,
    syncHealedSessionId,
  ]);

  // The Session row (model badge, context window, window notice, header price) follows the
  // model the conversation is on: when the running context's session_meta names another model
  // than the row on hand — a switch completed, on this tab or another one watching the
  // Session, or the row was held from before a switch — the row moves to it in place, the way
  // a title does. The server moved its own row before it published that record. Runs per
  // stream version because the model mutates in place.
  useEffect(() => {
    const running = stream.model.contextModel;
    if (!selected || running === null || stream.loading) return;
    if (!sessionRowStale(running, selected)) return;
    applySessionRow({ ...selected, provider: running.provider, modelId: running.modelId });
    // `version` is the model's change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.version, stream.model, stream.loading, selected, applySessionRow]);
  return {
    ...scope,
    selectedId,
    runCompaction,
    onCompact,
    onPickTurnThinkingLevel,
    compactThenThinkingSwitch,
    modelDisplay,
    onPickSessionModel,
    confirmModelSwitch,
  };
}
