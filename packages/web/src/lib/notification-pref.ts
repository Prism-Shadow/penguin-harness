/**
 * The task-completion notification's opt-in, and the OS permission it depends on
 * (state/use-completion-notifications.ts is the only reader of both).
 *
 * Two separate facts decide whether a notification can be shown, and neither implies the
 * other: the user asked for notifications (a preference of the account, cached here under
 * `penguin.notifications` and synced by lib/account-sync), and the platform granted THIS
 * browser permission to show them. The first follows the person to every browser; the second
 * never does — a browser that holds the account's "on" without a grant shows nothing until the
 * switch is turned on there, which is the gesture that asks. A browser reports the second as `Notification.permission`, and it starts at
 * "default" — no code path grants it, and on macOS a window that never calls
 * `requestPermission()` is not even listed in System Settings → Notifications.
 *
 * THE PROMPT IS TIED TO THE SWITCH, never to a page load. `requestPermission()` opens the
 * system dialog, an unexpected dialog is reflexively dismissed, and a dismissal is not a
 * question the platform asks twice: once denied, later calls resolve "denied" without
 * prompting and the only way back is the system's own settings. So permission is asked for
 * at the moment the user turns the preference on — an action that already says yes — and
 * the preference is stored only if that request came back granted.
 *
 * The store follows features/dock/dock-launcher-state.ts: a module-level version counter
 * read through `useSyncExternalStore`, with the value itself read separately, so the
 * settings row and the app-wide hook stay in step without either owning the state.
 */

import { PENGUIN_LOGO_URL } from "./brand-logo";
import { S } from "./strings";
import { subscribeAccountApplied, writeCached } from "./account-sync/cache";

/** localStorage key of the opt-in; only NOTIFICATIONS_ON counts as on. */
export const NOTIFICATIONS_KEY = "penguin.notifications";
/** Tag of the confirmation notice fired when the user turns the switch on. */
export const ENABLED_NOTIFICATION_TAG = "penguin-notifications-enabled";
const NOTIFICATIONS_ON = "1";
const NOTIFICATIONS_OFF = "0";

/** The storage this preference reads and writes — localStorage, or a stub in tests. */
export type NotificationStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): NotificationStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // the accessor itself throws where site data is blocked
  }
}

let version = 0;
const listeners = new Set<() => void>();
/**
 * The live value, read from storage once and kept in memory afterwards: the hook that reads
 * it sits in the app layout, which re-renders on every streamed token, and that is no place
 * for a synchronous storage read. As with the launcher's preference, a change made in
 * another tab is not seen until a reload.
 */
let cache: boolean | null = null;

export function subscribeNotificationsEnabled(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function notificationsEnabledVersion(): number {
  return version;
}

function enabledIn(storage: NotificationStorage | null): boolean {
  try {
    return storage?.getItem(NOTIFICATIONS_KEY) === NOTIFICATIONS_ON;
  } catch {
    return false;
  }
}

/**
 * Whether the user asked for task-completion notifications. Off unless the stored value is
 * exactly "1" — absent, stale or hand-edited all read as off, because turning this on is
 * what triggers a system permission prompt and nothing but an explicit choice should.
 * An explicit storage bypasses the cache.
 */
export function readNotificationsEnabled(storage?: NotificationStorage | null): boolean {
  if (storage !== undefined) return enabledIn(storage);
  if (cache === null) cache = enabledIn(defaultStorage());
  return cache;
}

function notify(): void {
  version += 1;
  for (const listener of listeners) listener();
}

/**
 * Stores the opt-in and tells everything rendering from it. Never touches OS permission. Without
 * an explicit storage this is a user's choice: cached and carried to the account.
 */
export function writeNotificationsEnabled(
  enabled: boolean,
  storage?: NotificationStorage | null,
): void {
  const value = enabled ? NOTIFICATIONS_ON : NOTIFICATIONS_OFF;
  try {
    if (storage === undefined) writeCached(NOTIFICATIONS_KEY, value);
    else storage?.setItem(NOTIFICATIONS_KEY, value);
  } catch {
    // Private-mode storage failures only cost persistence; this session still updates.
  }
  if (storage === undefined) cache = enabled;
  notify();
}

// The account's choice replaced the cached one: the next read takes it from the cache.
subscribeAccountApplied(() => {
  cache = null;
  notify();
});

/** A platform's answer, plus the case where it has no Notification API to answer with. */
export type NotificationAccess = NotificationPermission | "unsupported";

/** What the platform currently allows, read live — the OS may revoke it between renders. */
export function notificationPermission(): NotificationAccess {
  try {
    return typeof Notification === "undefined" ? "unsupported" : Notification.permission;
  } catch {
    return "unsupported";
  }
}

/**
 * Asks the platform for permission, which prompts the user only while the answer is still
 * "default"; an earlier grant or denial resolves immediately with that answer.
 *
 * The resolved value is checked against the live permission because the API has two
 * shapes — the promise of modern browsers and an older callback form that resolves
 * undefined — and a platform that hands back neither still leaves `Notification.permission`
 * correct.
 */
export async function requestNotificationPermission(): Promise<NotificationAccess> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    const answer = await Notification.requestPermission();
    return answer === "granted" || answer === "denied" || answer === "default"
      ? answer
      : notificationPermission();
  } catch {
    return notificationPermission();
  }
}

/**
 * Turning the preference on: permission first, storage only on "granted". Anything else —
 * a denial, a dismissed prompt (which leaves "default"), a platform without the API — is
 * returned for the caller to explain, and leaves the preference off, so the switch never
 * latches on over a notification that cannot be shown.
 *
 * A granted request also shows one confirmation notification on the spot, on every platform:
 * the user sees at once that notifications reach them, and Windows, which lists an app under
 * System › Notifications only once it has shown one, lists this app from then on. Showing it
 * is best-effort; a platform that will not construct a notification still keeps the opt-in.
 */
export async function enableNotifications(
  storage?: NotificationStorage | null,
): Promise<NotificationAccess> {
  const access = await requestNotificationPermission();
  if (access === "granted") {
    writeNotificationsEnabled(true, storage);
    try {
      const notification = new Notification(S.notify.enabledTitle, {
        body: S.notify.enabledBody,
        tag: ENABLED_NOTIFICATION_TAG,
        icon: PENGUIN_LOGO_URL,
      });
      notification.onclick = () => {
        notification.close();
        if (typeof window !== "undefined") window.focus();
      };
    } catch {
      // Best-effort: a non-constructible stub or restricted platform still keeps the
      // stored preference once permission itself was granted.
    }
  }
  return access;
}

/** What the settings row has to say under the switch, or null when it has nothing to add. */
export type NotificationHint = "unsupported" | "denied" | "dismissed" | "notAllowedHere" | null;

/**
 * The hint for a platform state. `asked` is whether a request has answered in this session,
 * and it is what separates the two meanings of "default": a platform that was never asked —
 * where every first visit starts, and nothing to report — from a prompt closed without an
 * answer, which is a request that failed and has to say so. Without that line the switch
 * springs back to off with no explanation, which reads as a control that does nothing.
 *
 * `wanted` is the account's preference. A browser that was never asked, under an account that
 * wants notifications, shows the switch off (this browser will show none) and says why: the
 * preference came from another browser, and turning the switch on here is the gesture that asks.
 */
export function notificationHintFor(
  access: NotificationAccess,
  asked: boolean,
  wanted = false,
): NotificationHint {
  if (access === "unsupported") return "unsupported";
  if (access === "denied") return "denied";
  if (access !== "default") return null;
  if (asked) return "dismissed";
  return wanted ? "notAllowedHere" : null;
}
