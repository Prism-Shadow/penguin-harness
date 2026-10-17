import { useCallback } from "react";
import type { AgentSummary, ModelRefDto, TaskInputPart } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { switchDeskModel } from "../../company";
import { ApiError } from "../../../api/client";
import { S } from "../../../lib/strings";
import { apiErrorText } from "../../../lib/api-error";
import { machineForSession } from "../../../lib/session-machines";
import { handoffMessage, modelSwitchMessage } from "../agent-handoff";
import type { useMainChatLifecycle } from "./main-chat-lifecycle";

/** Exact consecutive main ChatPage statements 128..134; called once, in original order. */
export function useMainChatSends(scope: ReturnType<typeof useMainChatLifecycle>) {
  const {
    navigate,
    company,
    currentAgent,
    projectId,
    addSession,
    models,
    selected,
    discardSessionDraft,
    turnThinkingLevel,
    syncHealedSessionId,
  } = scope;

  const onSend = useCallback(
    async (input: TaskInputPart[], goal: { budget: number } | null): Promise<boolean> => {
      if (!selected) return false;
      try {
        // No thinking level rides a task: the level belongs to the model context (pinned on
        // the Session through PATCH, see applyTurnThinkingLevel).
        const res = await api.postTask(selected.sessionId, {
          input,
          ...(goal ? { goal } : {}),
        });
        discardSessionDraft();
        await syncHealedSessionId(selected.sessionId, res.sessionId);
        return true;
      } catch (e) {
        // Returning false -> the input area keeps the draft, letting the user fix it and resend (the error copy includes the session model's upstream id).
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return false;
      }
    },
    [selected, turnThinkingLevel, discardSessionDraft, syncHealedSessionId],
  );

  // /model switch (handoff-style, mirroring onHandoff exactly): opens a NEW session for the
  // SAME agent on the picked model via the normal createSession API — deliberately with the
  // SOURCE session's Workspace, so files the conversation refers to stay reachable — then
  // posts a first task whose input starts with a [model_switch_from] source block (source
  // session id / its latest trace path / workspace / previous model pair) followed by the
  // user's remainder text and images. The earlier history is NOT injected into the new
  // context (some models require thinking payloads and provider fidelity byte-for-byte on
  // history replay, which cannot cross models); the model reads the source trace file itself
  // when it needs the context. Returns false on failure, keeping the draft so it can be
  // resent (the empty session that never got its first message is deleted, like handoff).
  const onSwitchModel = useCallback(
    async (ref: ModelRefDto, input: TaskInputPart[]): Promise<boolean> => {
      if (!projectId || !selected) return false;
      // The source's latest trace file path comes from the single-session GET (list rows
      // don't carry it); best-effort — a brand-new source has no trace, the block then
      // simply omits the line.
      const tracePath = await api
        .getSession(selected.sessionId)
        .then((res) => res.session.tracePath)
        .catch(() => undefined);
      const origin: TaskInputPart = {
        type: "text",
        text: modelSwitchMessage({
          sessionId: selected.sessionId,
          ...(selected.title !== undefined ? { sessionTitle: selected.title } : {}),
          ...(tracePath !== undefined ? { tracePath } : {}),
          workspace: selected.workspace,
          prevProvider: selected.provider,
          prevModelId: selected.modelId,
        }),
      };
      // A desk is not forked: the switch is the EMPLOYEE's. Its model goes into the chart and
      // its desk is renewed onto it (features/company/desk-model.ts), so the organization —
      // its sidebar, its calendar rounds, its @mentions — follows to the Session the person
      // is now talking in, instead of staying on the old one while a stray one is opened.
      if (selected.orgId !== undefined) {
        try {
          const deskId = await switchDeskModel(
            api,
            {
              projectId,
              orgId: selected.orgId,
              agentId: selected.agentId,
              sessionId: selected.sessionId,
            },
            ref,
          );
          if (deskId !== null) {
            const res = await api.postTask(deskId, { input: [origin, ...input] });
            discardSessionDraft();
            void company.reloadOrgChart();
            void company.reloadOrgSessions();
            navigate(`/chat/${res.sessionId}`);
            return true;
          }
        } catch (e) {
          // The model may be written and the desk renewed by now; the lists say which.
          void company.reloadOrgChart();
          void company.reloadOrgSessions();
          toastError(apiErrorText(e, { modelId: ref.modelId }));
          return false;
        }
      }
      let createdId: string | null = null;
      try {
        const created = await api.createSession(
          projectId,
          selected.agentId,
          {
            provider: ref.provider,
            modelId: ref.modelId,
            workspace: selected.workspace,
            approvalMode: selected.approvalMode,
            sandbox: selected.sandbox,
          },
          // On the machine the source Session is on: the Workspace being carried over is a
          // directory THERE, and this server would refuse a path it does not have
          // ("Workspace does not exist or is inaccessible"). The machine travels with the
          // path, here as everywhere.
          machineForSession(selected.sessionId),
        );
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input: [origin, ...input] });
        addSession(created.session);
        // The remainder text has been carried into the new chat: discard the source session's input draft along with it.
        discardSessionDraft();
        navigate(`/chat/${res.sessionId}`);
        return true;
      } catch (e) {
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        toastError(apiErrorText(e, { modelId: ref.modelId }));
        return false;
      }
    },
    [projectId, selected, addSession, discardSessionDraft, navigate, company],
  );

  // /agent handoff: doesn't use the current Session — creates a new chat for the picked agent
  // (approval mode carries over from the input area's current value; model/Workspace use the
  // creation defaults). The first input = a [handoff_from] source block (current agent / Session
  // / Workspace info) + the user's input and images; jumps to the new
  // chat once sent.
  // Returns false on failure, keeping the draft so it can be resent (deletes the empty Session that never got its first message sent).
  const onHandoff = useCallback(
    async (target: AgentSummary, input: TaskInputPart[]): Promise<boolean> => {
      if (!projectId || !currentAgent || !selected) return false;
      const origin: TaskInputPart = {
        type: "text",
        text: handoffMessage({
          agentId: currentAgent.agentId,
          ...(currentAgent.name !== undefined ? { agentName: currentAgent.name } : {}),
          sessionId: selected.sessionId,
          workspace: selected.workspace,
          ...(selected.title !== undefined ? { sessionTitle: selected.title } : {}),
        }),
      };
      let createdId: string | null = null;
      try {
        const created = await api.createSession(projectId, target.agentId, {
          approvalMode: selected.approvalMode,
          sandbox: selected.sandbox,
        });
        createdId = created.session.sessionId;
        const res = await api.postTask(createdId, { input: [origin, ...input] });
        addSession(created.session);
        // The text body has been handed off into the new chat: discard the current session's input draft along with it.
        discardSessionDraft();
        navigate(`/chat/${res.sessionId}`);
        return true;
      } catch (e) {
        if (createdId) void api.deleteSession(createdId).catch(() => undefined);
        // The new chat uses the project's default model (createSession doesn't specify a model reference), so the error copy's model context follows suit.
        toastError(
          apiErrorText(e, models?.defaultModel ? { modelId: models.defaultModel.modelId } : {}),
        );
        return false;
      }
    },
    [projectId, currentAgent, selected, addSession, discardSessionDraft, navigate, models],
  );

  const onStop = useCallback(async () => {
    if (!selected) return;
    await api.postAbort(selected.sessionId).catch(() => undefined);
  }, [selected]);

  // "Retry" on the line a failed run ended on: the Session runs once with no new input and
  // sends the failed turn's held input on its own. A refusal surfaces as a toast — nothing held
  // (a later message already sent it) has its own sentence, anything else reads like a failed
  // send — and is rethrown, which enables the button again.
  const onRetry = useCallback(async (): Promise<void> => {
    if (!selected) return;
    try {
      // Same shape as tasks: the response carries the Session's actual id.
      const res = await api.postRetry(selected.sessionId);
      await syncHealedSessionId(selected.sessionId, res.sessionId);
    } catch (e) {
      toastError(
        e instanceof ApiError && e.code === "nothing_to_retry"
          ? S.chat.retryNothing
          : apiErrorText(e, { modelId: selected.modelId }),
      );
      throw e;
    }
  }, [selected, syncHealedSessionId]);

  // Follow-up queue: post the full input with queueIfBusy — a busy session holds it
  // server-side and auto-sends it as an ordinary next task once this run finishes (the
  // "N queued" count arrives via task_state). Succeeds either way (queued or started
  // directly in the completion race), so the input area clears the draft on true.
  // The per-turn thinking level rides along exactly as it does on onSend: the level is the
  // one picked when the follow-up was composed, and the server keeps it with the queued
  // input and applies it at auto-start (see TaskCreateRequest.queueIfBusy).
  const onQueueFollowUp = useCallback(
    async (input: TaskInputPart[]): Promise<boolean> => {
      if (!selected) return false;
      try {
        const res = await api.postTask(selected.sessionId, { input, queueIfBusy: true });
        discardSessionDraft();
        await syncHealedSessionId(selected.sessionId, res.sessionId);
        return true;
      } catch (e) {
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return false;
      }
    },
    [selected, turnThinkingLevel, discardSessionDraft, syncHealedSessionId],
  );

  // Mid-run steering: the message is queued on the server and delivered between turns as a
  // standalone `[user_steering]` user message followed by its images (visible once they
  // arrive over SSE / from the Trace); file attachments land in the Session scratchpad and
  // ride the steering text as `[attached file: <path>]` lines, exactly as a task's do. On
  // "queued" the localStorage draft is discarded, like a successful send — without this a
  // reload resurrects the already-sent text as a draft, and re-sending it duplicates the
  // steering message (#136). "not_running" (409) means no Task is in progress anymore (race
  // with completion): the input area then falls back to its **full** normal send path —
  // skills and the whole draft included — rather than a text+images task.
  const onSteer = useCallback(
    async (
      text: string,
      images: string[] = [],
      files: { fileName: string; dataUrl: string }[] = [],
    ): Promise<"queued" | "not_running" | "failed"> => {
      if (!selected) return "failed";
      try {
        await api.postSteer(selected.sessionId, {
          text,
          ...(images.length > 0 ? { images } : {}),
          ...(files.length > 0 ? { files } : {}),
        });
        discardSessionDraft();
        return "queued";
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return "not_running";
        toastError(apiErrorText(e, { modelId: selected.modelId }));
        return "failed";
      }
    },
    [selected, discardSessionDraft],
  );
  return { ...scope, onSend, onSwitchModel, onHandoff, onStop, onRetry, onQueueFollowUp, onSteer };
}
