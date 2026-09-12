/**
 * The task-completion notification's opt-in, and the OS permission it depends on
 * (state/use-completion-notifications.ts is the only reader of both).
 *
 * Two separate facts decide whether a notification can be shown, and neither implies the
 * other: the user asked for notifications (stored here, `penguin.notifications`, registered
 * as a browser preference in lib/install-scope.ts), and the platform granted permission to
 * show them. A browser reports the second as `Notification.permission`, and it starts at
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

/** localStorage key of the opt-in; only NOTIFICATIONS_ON counts as on. */
export const NOTIFICATIONS_KEY = "penguin.notifications";
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

/** Stores the opt-in and tells everything rendering from it. Never touches OS permission. */
export function writeNotificationsEnabled(
  enabled: boolean,
  storage?: NotificationStorage | null,
): void {
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.setItem(NOTIFICATIONS_KEY, enabled ? NOTIFICATIONS_ON : NOTIFICATIONS_OFF);
  } catch {
    // Private-mode storage failures only cost persistence; this session still updates.
  }
  if (storage === undefined) cache = enabled;
  version += 1;
  for (const listener of listeners) listener();
}

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
 */
export async function enableNotifications(
  storage?: NotificationStorage | null,
): Promise<NotificationAccess> {
  const access = await requestNotificationPermission();
  if (access === "granted") writeNotificationsEnabled(true, storage);
  return access;
}
