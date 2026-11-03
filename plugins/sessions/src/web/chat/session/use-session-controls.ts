/**
 * The open conversation's in-place controls: the composer handle the dock's panels write into,
 * the Session row's updates (thinking level, approval mode, sandbox), recalling a queued message,
 * approval decisions, and moving a tool call to the background.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SessionInfo, SessionPatchRequest } from "@prismshadow/penguin-server/api";
import { toastError } from "@prismshadow/penguin-ui";
import * as api from "../../../api/endpoints";
import { ApiError } from "../../../api/client";
import { a2uiDrafts } from "../../../lib/a2ui-drafts";
import { apiErrorText } from "../../../lib/api-error";
import type { PermissionPick } from "../../../lib/permission-level";
import { onPluginConfigSaved } from "../../../lib/plugin-config-event";
import { approvalKey } from "../../../lib/omni/stream-model";
import type { ComposerReference } from "../../../lib/workspace-tree";
import { useLocale } from "../../../state/locale";
import type { ComposerControl } from "../chat-input";
import type { A2uiActions } from "../message-stream";
import type { SessionStreamState } from "../use-session-stream";
import type { ChatInputs } from "./use-chat-inputs";
import type { RoutedSession } from "./use-routed-session";

export function useSessionControls({
  replace,
  setFetchedSession,
  selected,
  stream,
}: Pick<ChatInputs, "replace"> &
  Pick<RoutedSession, "setFetchedSession"> & {
    selected: SessionInfo | null;
    stream: SessionStreamState;
  }) {
  const [modeSaving, setModeSaving] = useState(false);
  /**
   * The scheduled-tasks panel's exit: the composed prompt lands in this conversation's composer
   * and stops there. Nothing is posted — pressing Send stays the user's move, and the composer
   * then routes it the way it routes anything typed (a steering message while a Task runs, a
   * task otherwise), so this path needs no delivery rules of its own.
   */
  const composerRef = useRef<ComposerControl | null>(null);
  const prefillComposer = useCallback((text: string) => {
    // An empty pin list: a schedule prompt names no Skills, so the composer's own selection stands.
    composerRef.current?.fillPrompt(text, []);
  }, []);
  /**
   * A reply's choice or form block answers through the same exit: the picked text lands in the
   * composer (replacing typed text only after the user confirms) and Send stays the user's move;
   * its "Other…" only sends focus there. The transcript decides which reply may use these (see
   * MessageItems); memoized because the blocks read them through context, past the memoized
   * Markdown.
   */
  const { locale } = useLocale();
  const a2uiActions = useMemo<A2uiActions>(
    () => ({
      interactive: true,
      fill: prefillComposer,
      lang: locale,
      drafts: a2uiDrafts,
      draftScope: selected?.sessionId,
    }),
    [prefillComposer, locale, selected?.sessionId],
  );
  /**
   * The Files panel's exit into the conversation — a `@path` reference, or a fenced block
   * around what was selected in a preview — and the message stream's, an excerpt of the
   * conversation selected in it. Nothing is sent and nothing already typed is disturbed: the
   * surface contributes a part of a message the user is writing.
   */
  /** Staged as a chip, so the draft keeps whatever the user was in the middle of writing. */
  const addComposerReference = useCallback((reference: ComposerReference) => {
    composerRef.current?.addReference(reference);
  }, []);

  // A fresh Session row from the server, applied wherever the page reads the row from: the
  // paged list, and the direct lookup's copy for a row the list does not hold (see
  // resolveRoutedSession).
  const applySessionRow = useCallback(
    (session: SessionInfo) => {
      replace(session);
      setFetchedSession((cur) =>
        cur !== null && cur.sessionId === session.sessionId ? session : cur,
      );
    },
    [replace],
  );

  // Pins a picked level on the Session so it outlives this tab: PATCH, then swap the
  // returned row into the session store (the picker reads it back from there); it applies
  // from the next LLM request (the picker's menu advises compacting first). Modeled on
  // onChangePermission — a failed write surfaces as a toast and leaves the level as it
  // was, rather than showing a level the server does not have.
  const applyTurnThinkingLevel = useCallback(
    (level: string) => {
      if (!selected) return;
      void api
        .patchSession(selected.sessionId, {
          thinkingLevel: level as SessionPatchRequest["thinkingLevel"],
        })
        .then((res) => replace(res.session))
        .catch((e: unknown) => {
          toastError(apiErrorText(e));
        });
    },
    [selected, replace],
  );

  // Recall a queued message back into the composer (#287): the DELETE returns the original
  // content (text / images / files) and the input area restores it as the draft. A 409 —
  // not_pending (steering already delivered) or follow_up_started (the follow-up already
  // became a task) — surfaces as a toast, each with its own sentence; the queued hint
  // retires on its own via the re-broadcast task_state.
  const onRecallSteering = useCallback(
    async (steerId: string) => {
      if (!selected) return null;
      try {
        return await api.recallSteer(selected.sessionId, steerId);
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
      }
    },
    [selected],
  );

  const onRecallFollowUp = useCallback(
    async (followUpId: string) => {
      if (!selected) return null;
      try {
        // A queued follow-up carries no thinking level of its own: the level lives on the
        // Session and applies per model context, so a resend goes out at whatever the Session
        // is pinned to.
        return await api.recallFollowUp(selected.sessionId, followUpId);
      } catch (e) {
        toastError(apiErrorText(e));
        return null;
      }
    },
    [selected],
  );

  const onApprove = useCallback(
    async (toolCallId: string, decision: "allow" | "deny", origin: string[]) => {
      if (!selected) return;
      // A decision clicked locally is marked "manual"; removed from the pending table keyed by the origin composite key.
      stream.markLocalDecision(toolCallId);
      const key = approvalKey(origin, toolCallId);
      try {
        await api.postApproval(selected.sessionId, toolCallId, { decision });
        stream.resolveApproval(key);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) stream.resolveApproval(key);
      }
    },
    [selected, stream],
  );

  // "Move to background" on an executing tool call: the call returns a background handle and
  // the turn carries on. 404 means it finished in the click's race window and 409 that the
  // tool has no background form — the card settles on its own either way, so neither is worth
  // a toast; anything else is a real failure the user should see.
  const onSendToBackground = useCallback(
    async (toolCallId: string) => {
      if (!selected) return;
      try {
        await api.postToolCallBackground(selected.sessionId, toolCallId);
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.status === 409)) return;
        toastError(apiErrorText(e));
      }
    },
    [selected],
  );

  // A preset from the permission button: the approval mode and the Session's own sandbox
  // policy in one PATCH, applied from the next tool call and command. A refused change (a
  // non-admin loosening past the server's settings) stores nothing — the route checks every
  // field before writing any — so the Session is as it was, and the toast says why.
  const onChangePermission = useCallback(
    (pick: PermissionPick) => {
      if (!selected || modeSaving) return;
      setModeSaving(true);
      // Returned so the permission button keeps the pick on screen until the save settles.
      return api
        .patchSession(selected.sessionId, {
          approvalMode: pick.approvalMode,
          // Absent for an approval-mode pick: the Session's policy is left as it is.
          ...(pick.sandbox !== undefined ? { sandbox: pick.sandbox } : {}),
        })
        .then((res) => replace(res.session))
        .catch((e: unknown) => toastError(apiErrorText(e)))
        .finally(() => setModeSaving(false));
    },
    [selected, modeSaving, replace],
  );

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
  return {
    composerRef,
    prefillComposer,
    addComposerReference,
    applySessionRow,
    applyTurnThinkingLevel,
    onRecallSteering,
    onRecallFollowUp,
    onApprove,
    onSendToBackground,
    a2uiActions,
    modeSaving,
    onChangePermission,
  };
}
