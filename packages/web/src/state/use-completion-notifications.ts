/**
 * Desktop task-completion notifications, renderer-side only (standard Web Notification
 * API — no preload, no private IPC: the desktop window stays a plain browser environment).
 *
 * Watches the tracked Session list for active→idle transitions (lib/completion-notify)
 * and, when the window is hidden or unfocused, shows a system notification with the
 * Session's title; clicking focuses the window and opens that Session. Gated to
 * sessionVia === "desktop": only the desktop shell's own window qualifies — there the
 * Notification permission is granted by default, so plain browsers (which would face a
 * permission prompt) are never touched.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { S } from "../lib/strings";
import { createCompletionTracker } from "../lib/completion-notify";
import { useAuth } from "./auth";
import { useProject } from "./project";
import { useSessions } from "./sessions";

export function useCompletionNotifications(): void {
  const { sessionVia } = useAuth();
  const { sessions } = useSessions();
  const { setCurrentAgentId } = useProject();
  const navigate = useNavigate();

  const trackerRef = useRef(createCompletionTracker());
  // Click handlers fire long after the effect ran: read the latest helpers via refs.
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const setCurrentAgentIdRef = useRef(setCurrentAgentId);
  setCurrentAgentIdRef.current = setCurrentAgentId;

  const enabled = sessionVia === "desktop";
  useEffect(() => {
    if (!enabled) return;
    // The tracker must see every snapshot (also while focused): completions the user
    // watched happen are consumed silently instead of surfacing on a later blur.
    const completed = trackerRef.current.observe(
      sessions.map((s) => ({ sessionId: s.sessionId, status: s.status })),
    );
    if (completed.length === 0) return;
    if (!document.hidden && document.hasFocus()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    for (const sessionId of completed) {
      const session = sessions.find((s) => s.sessionId === sessionId);
      const title = session?.title ?? S.chat.defaultSessionTitle;
      const agentId = session?.agentId ?? null;
      try {
        const notification = new Notification(S.notify.taskCompleteTitle, {
          body: S.notify.taskCompleteBody(title),
          // One notification per Session: a newer completion replaces the stale one.
          tag: `penguin-task-${sessionId}`,
          icon: "/penguin-logo.svg",
        });
        notification.onclick = () => {
          notification.close();
          window.focus();
          // Mirrors the sidebar's openSession: the current agent follows the Session.
          if (agentId !== null) setCurrentAgentIdRef.current(agentId);
          navigateRef.current(`/chat/${sessionId}`);
        };
      } catch {
        // Notification construction is best-effort; a platform refusing it must not
        // break the app.
      }
    }
  }, [enabled, sessions]);
}
