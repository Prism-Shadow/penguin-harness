/**
 * Draft auto-cache for an existing session's input area: text + the two staged switch chips
 * (`/agent` handoff target, `/model` switch target) + selected skills are cached to
 * localStorage keyed by "user x Session" (see draft-cache's sessionDraftKey; the user
 * dimension prevents cross-account leakage on the same browser, #68), restored after
 * navigating away/reloading. The Session's OWN model / Workspace / approval mode are locked
 * and need no caching — the cached model reference here is the pending switch target, not the
 * session's model.
 *
 * Write strategy matches the draft page: text is debounced and merge-written (an unflushed
 * edit gets one extra flush before switching sessions/unmounting); the switch chips and the
 * skill selection write immediately; **clearing content deletes the key** (leaving an empty
 * shell per session would bloat localStorage); discard on a successful send cancels the
 * pending timer first, otherwise it would write the just-cleared draft back.
 *
 * ChatPage keys session content blocks by sessionId, so ChatInput remounts accordingly, but
 * this hook is mounted on ChatPage itself and does not remount — switching sessions is
 * handled by the [key] effect: cleanup flushes the old session via its stale closure, setup
 * resets the refs to the new session's initial values.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ModelRefDto } from "@prismshadow/penguin-server/api";
import { useAuth } from "../../state/auth";
import { clearDraft, loadDraft, saveDraft, sessionDraftKey } from "./draft-cache";
import type { DraftCache } from "./draft-cache";

const SAVE_DEBOUNCE_MS = 300;

export function useSessionDraft(sessionId: string | null): {
  /** Initial draft value for the current session (recomputed with sessionId; consumed by ChatInput after it remounts on sessionId). */
  initial: DraftCache;
  onTextChange: (text: string) => void;
  onHandoffTargetChange: (agentId: string | null) => void;
  /** Staged `/model` switch target change (picked/removed); like the handoff target, a discrete action writes immediately. */
  onPendingModelChange: (ref: ModelRefDto | null) => void;
  /** Selected-skills change (wired directly to ChatInput's onSkillsChange; a discrete action writes immediately). */
  onSkillsChange: (names: string[]) => void;
  /** Discard the current session's draft after a successful send. */
  discard: () => void;
} {
  // No user (shouldn't happen under RequireAuth) disables caching entirely: must not read/write account-agnostic keys (#68).
  const userId = useAuth().user?.userId ?? null;
  const key = userId && sessionId ? sessionDraftKey(userId, sessionId) : null;
  const initial = useMemo<DraftCache>(() => (key ? loadDraft(key) : {}), [key]);

  const textRef = useRef(initial.text ?? "");
  const handoffRef = useRef<string | null>(initial.handoffAgentId ?? null);
  const switchModelRef = useRef<ModelRefDto | null>(initial.switchModelRef ?? null);
  const skillsRef = useRef<string[]>(initial.skills ?? []);
  const timer = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const persistNow = useCallback(() => {
    cancelPending();
    if (!key) return;
    const text = textRef.current;
    const handoffAgentId = handoffRef.current;
    const pendingModel = switchModelRef.current;
    const skills = skillsRef.current;
    if (!text && !handoffAgentId && !pendingModel && skills.length === 0) {
      clearDraft(key);
      return;
    }
    const data: DraftCache = { text };
    if (handoffAgentId) data.handoffAgentId = handoffAgentId;
    if (pendingModel) data.switchModelRef = pendingModel;
    if (skills.length > 0) data.skills = skills;
    saveDraft(key, data);
  }, [cancelPending, key]);

  // Switching session / unmounting: cleanup first flushes the old session's unsaved text
  // (persistNow's closure still holds the old key), then setup resets the refs to the new
  // session's initial values.
  useEffect(() => {
    textRef.current = initial.text ?? "";
    handoffRef.current = initial.handoffAgentId ?? null;
    switchModelRef.current = initial.switchModelRef ?? null;
    skillsRef.current = initial.skills ?? [];
    return () => {
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
        persistNow();
      }
    };
  }, [initial, persistNow]);

  const onTextChange = useCallback(
    (text: string) => {
      textRef.current = text;
      cancelPending();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        persistNow();
      }, SAVE_DEBOUNCE_MS);
    },
    [cancelPending, persistNow],
  );

  const onHandoffTargetChange = useCallback(
    (agentId: string | null) => {
      handoffRef.current = agentId;
      // Discrete action writes immediately (text is carried along via textRef).
      persistNow();
    },
    [persistNow],
  );

  const onPendingModelChange = useCallback(
    (ref: ModelRefDto | null) => {
      switchModelRef.current = ref;
      // Same as the handoff target: discrete action writes immediately.
      persistNow();
    },
    [persistNow],
  );

  const onSkillsChange = useCallback(
    (names: string[]) => {
      skillsRef.current = names;
      // Same as the handoff target: discrete action writes immediately.
      persistNow();
    },
    [persistNow],
  );

  const discard = useCallback(() => {
    cancelPending();
    // Also clear the text, the selected skills and both staged switch chips: ChatInput's
    // clear after a successful send doesn't fire a callback (same convention as
    // onTextChange); without this, a later flush triggered by any discrete action (a skill
    // toggle, a staged chip) would resurrect the already-sent text or selection.
    textRef.current = "";
    skillsRef.current = [];
    handoffRef.current = null;
    switchModelRef.current = null;
    if (key) clearDraft(key);
  }, [cancelPending, key]);

  return {
    initial,
    onTextChange,
    onHandoffTargetChange,
    onPendingModelChange,
    onSkillsChange,
    discard,
  };
}
