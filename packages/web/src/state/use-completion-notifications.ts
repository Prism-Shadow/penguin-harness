/**
 * Task-completion notifications, renderer-side only (standard Web Notification API — no
 * preload, no private IPC: the desktop window stays a plain browser environment).
 *
 * Watches the tracked Session list for active→idle transitions (lib/completion-notify)
 * and, when the window is hidden or unfocused, shows a system notification with the
 * Session's title; clicking focuses the window and opens that Session.
 *
 * The gates and the `new Notification` itself live in lib/system-notify.ts, shared with the
 * transcript's own announcements (a question card arriving, a retry ladder starting to wait).
 * This module's remaining job is the one thing that is specific to completions: reading the
 * transition out of the Session list, which covers every Session rather than only the one on
 * screen — and which is why it sits in the app layout and not on the chat page.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { createCompletionTracker } from "../lib/completion-notify";
import {
  notificationsEnabledVersion,
  readNotificationsEnabled,
  subscribeNotificationsEnabled,
} from "../lib/notification-pref";
import { showSystemNotification } from "../lib/system-notify";
import { useProject } from "./project";
import { useSessions } from "./sessions";

export function useCompletionNotifications(): void {
  const { sessions } = useSessions();
  const { setCurrentAgentId } = useProject();
  const navigate = useNavigate();

  const trackerRef = useRef(createCompletionTracker());
  // Click handlers fire long after the effect ran: read the latest helpers via refs.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const setCurrentAgentIdRef = useRef(setCurrentAgentId);
  setCurrentAgentIdRef.current = setCurrentAgentId;

  // The settings switch writes the preference; this follows it without a reload, and it is not
  // read as a gate here — lib/system-notify.ts owns that.
  useSyncExternalStore(subscribeNotificationsEnabled, notificationsEnabledVersion);
  const enabled = readNotificationsEnabled();
  useEffect(() => {
    // The tracker must see every snapshot — also while focused, and also while the
    // preference is off: completions the user watched happen, or that happened while
    // notifications were switched off, are consumed silently here instead of surfacing on
    // a later blur or replaying the moment the preference is switched back on.
    const completed = trackerRef.current.observe(
      sessions.map((s) => ({ sessionId: s.sessionId, status: s.status })),
    );
    for (const sessionId of completed) {
      const session = sessions.find((s) => s.sessionId === sessionId);
      const title = session?.title ?? S.chat.defaultSessionTitle;
      const agentId = session?.agentId ?? null;
      showSystemNotification({
        tag: `penguin-task-${sessionId}`,
        title: S.notify.taskCompleteTitle,
        body: S.notify.taskCompleteBody(title),
        onClick: () => {
          // Mirrors the sidebar's openSession: the current agent follows the Session.
          if (agentId !== null) setCurrentAgentIdRef.current(agentId);
          navigateRef.current(`/chat/${sessionId}`);
        },
      });
    }
  }, [enabled, sessions]);
}
