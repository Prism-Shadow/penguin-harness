/**
 * Company push notifications, renderer-side only (standard Web Notification API — no
 * preload, no private IPC, exactly like state/use-completion-notifications.ts).
 *
 * Subscribes the company event fan-out and, when the window is hidden or unfocused,
 * shows one system notification per event whose group the user left on
 * (lib/company-notify.ts): an @-mention, a channel message, a ticket change, a run
 * start, a budget warning. Clicking focuses the window and opens where the event
 * lives — the channel, the tickets board, the overview, or finance.
 *
 * Three gates, checked live on every event: the master notifications switch, the
 * event's group, and the OS permission (revoked mid-run reads as "don't show").
 * Your own channel messages never notify — you wrote them — and ticket, run and
 * budget events carry no actor, so they cannot tell yours apart (a limitation of
 * the event shape; the server would have to ship who acted).
 */
import { useSyncExternalStore } from "react";
import { useNavigate } from "react-router";
import type { CompanyServerEvent } from "@prismshadow/penguin-server/api";
import { PENGUIN_LOGO_URL } from "../lib/brand-logo";
import {
  describeCompanyEvent,
  groupOfCompanyEvent,
  notifyGroupsVersion,
  readNotifyGroups,
  subscribeNotifyGroups,
} from "../lib/company-notify";
import {
  notificationPermission,
  notificationsEnabledVersion,
  readNotificationsEnabled,
  subscribeNotificationsEnabled,
} from "../lib/notification-pref";
import { useAuth } from "./auth";
import { useCompanyEvents } from "./company";

export function useCompanyNotifications(): void {
  const { user } = useAuth();
  const navigate = useNavigate();
  const userId = user?.userId ?? null;

  // Both preference stores, followed without a reload; the permission is read live
  // on every event instead (the OS may revoke it while the app runs).
  useSyncExternalStore(subscribeNotificationsEnabled, notificationsEnabledVersion);
  useSyncExternalStore(subscribeNotifyGroups, notifyGroupsVersion);

  useCompanyEvents((ev: CompanyServerEvent) => {
    if (!readNotificationsEnabled()) return;
    const groups = readNotifyGroups();
    const group = groupOfCompanyEvent(ev, userId);
    if (group === null || !groups[group]) return;
    if (!document.hidden && document.hasFocus()) return;
    if (notificationPermission() !== "granted") return;
    if (ev.type === "org_channel" && ev.message.sender === `user:${userId ?? ""}`) return;
    const content = describeCompanyEvent(ev, group);
    try {
      const notification = new Notification(content.title, {
        body: content.body,
        tag: content.tag,
        icon: PENGUIN_LOGO_URL,
      });
      notification.onclick = () => {
        notification.close();
        window.focus();
        navigate(content.path);
      };
    } catch {
      // Notification construction is best-effort; a platform refusing it must not
      // break the app.
    }
  });
}
