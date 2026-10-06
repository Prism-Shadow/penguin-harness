/**
 * The system notification presenter: the three gates every announcement passes through, and the
 * one place this app constructs a `new Notification`.
 *
 * Three things reach out of the window, and they answer the same questions before they may. A
 * task finishing (state/use-completion-notifications.ts), a question card arriving and a dropped
 * request starting to retry (features/chat/use-transcript-notifications.ts) each walk through
 * here — which is why the one switch in Settings › General covers all of them, and why a fourth
 * announcement cannot invent a fourth answer to "may I interrupt this person".
 *
 * **Why the gates are not the caller's business.** They are the same three everywhere, in the
 * same order: the user asked for notifications (lib/notification-pref — off until they turn it
 * on), the window is out of the way, and the platform grants permission *at this moment*
 * (an OS can revoke it while the app runs, and a revoked permission must not be read as "show it
 * anyway"). A caller that forgot one of them would not fail loudly; it would quietly announce
 * something into a window the user is looking at.
 *
 * **Renderer-side only**: the standard Web Notification API, no preload and no private IPC — the
 * desktop window stays a plain browser environment, and a browser is a first-class host of this
 * feature rather than a degraded one.
 */
import { notificationPermission, readNotificationsEnabled } from "./notification-pref";

/** Everything an announcement carries: its identity in the notification centre, and its words. */
export interface SystemNotice {
  /**
   * Notification-centre identity. A later notice with the same tag **replaces** the stale one
   * instead of stacking up beside it, so callers tag per Session — one doorbell per conversation,
   * not one per event.
   */
  tag: string;
  title: string;
  body: string;
  /**
   * Runs after the click has closed the notification and brought the window forward. Callers
   * navigate; a caller with something to point at may also reveal it (see the ask-card path).
   */
  onClick?: () => void;
}

/**
 * Whether an announcement is welcome right now: opted in, window in the background, permission
 * live. Split out from `showSystemNotification` so the decision can be read without constructing
 * anything, and so the order below is stated once.
 *
 * The permission is checked *before* the window, and deliberately: it is the only gate that
 * answers without a document to look at (a platform with no Notification API answers
 * "unsupported"), which keeps the whole function callable from code that has no DOM.
 */
export function canNotify(): boolean {
  if (!readNotificationsEnabled()) return false;
  if (notificationPermission() !== "granted") return false;
  return document.hidden || !document.hasFocus();
}

/**
 * Shows `notice` if it is welcome, and reports whether it was. Best-effort by contract: a
 * platform that refuses to construct a notification (a browser with the API but a blocked
 * origin, a sandboxed renderer) costs the announcement, never the app.
 */
export function showSystemNotification(notice: SystemNotice): boolean {
  if (!canNotify()) return false;
  try {
    const notification = new Notification(notice.title, {
      body: notice.body,
      tag: notice.tag,
      icon: "/penguin-logo.svg",
    });
    notification.onclick = () => {
      notification.close();
      // The window first, then the caller's own move: focusing may be what un-hides the page,
      // and a caller that scrolls to something has to do it in a visible document.
      window.focus();
      notice.onClick?.();
    };
    return true;
  } catch {
    return false;
  }
}
