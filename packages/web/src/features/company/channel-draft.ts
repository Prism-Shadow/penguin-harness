/**
 * A channel composer's unsent text, kept across leaving the channel and reloading the page.
 *
 * Cached in localStorage per "user × Project × organization × channel" — the user dimension
 * for the same reason the chat drafts carry it (draft-cache.ts): two accounts on one browser
 * must not read each other's unsent words. The storage helpers are the chat drafts' own; a
 * channel draft is their `text` field and nothing else.
 *
 * The write strategy is the session composer's (use-session-draft.ts): typing is debounced, an
 * edit still waiting for its timer is flushed when the channel changes or the view unmounts,
 * an emptied box deletes the key rather than leaving a shell per channel, and a successful
 * send cancels the pending write first — otherwise it would put the sent text back.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAuth } from "../../state/auth";
import { clearDraft, loadDraft, saveDraft } from "../chat/draft-cache";
import type { DraftStorage } from "../chat/draft-cache";

const SAVE_DEBOUNCE_MS = 300;

export const channelDraftKey = (
  userId: string,
  projectId: string,
  orgId: string,
  channelId: string,
): string => `penguin.channelDraft.${userId}.${projectId}.${orgId}.${channelId}`;

export function loadChannelDraft(key: string, storage?: DraftStorage): string {
  return loadDraft(key, storage).text ?? "";
}

/** Writes the text, or deletes the key when there is nothing left to keep. */
export function storeChannelDraft(key: string, text: string, storage?: DraftStorage): void {
  if (text === "") clearDraft(key, storage);
  else saveDraft(key, { text }, storage);
}

export function useChannelDraft(
  projectId: string,
  orgId: string,
  channelId: string,
): {
  /** Identifies the draft: the composer remounts on it, so it starts from `initial`. */
  key: string | null;
  initial: string;
  onTextChange: (text: string) => void;
  /** Drops the draft after a successful send. */
  discard: () => void;
} {
  // No user (should not happen under RequireAuth) disables the cache: never an account-less key.
  const userId = useAuth().user?.userId ?? null;
  const key = userId === null ? null : channelDraftKey(userId, projectId, orgId, channelId);
  const initial = useMemo(() => (key === null ? "" : loadChannelDraft(key)), [key]);

  const textRef = useRef(initial);
  const timer = useRef<number | null>(null);

  const cancelPending = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const persistNow = useCallback(() => {
    cancelPending();
    if (key !== null) storeChannelDraft(key, textRef.current);
  }, [cancelPending, key]);

  // Another channel, or leaving: the cleanup flushes the old channel's pending edit (its
  // closure still holds the old key), then setup starts from the new channel's draft.
  useEffect(() => {
    textRef.current = initial;
    return () => {
      if (timer.current !== null) persistNow();
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

  const discard = useCallback(() => {
    cancelPending();
    textRef.current = "";
    if (key !== null) clearDraft(key);
  }, [cancelPending, key]);

  return { key, initial, onTextChange, discard };
}
