/**
 * The task-completion notification's opt-in (lib/notification-pref): what the stored
 * preference reads as, and what a request for OS permission does to it. The preference and
 * the permission are separate facts, and the switch must never latch on over notifications
 * that can never be shown.
 *
 * - The opt-in is off unless the stored value is exactly the on marker.
 * - A write round-trips and tells the subscribers (until they unsubscribe).
 * - A storage that throws costs persistence only: reads are off and writes do not throw.
 * - A platform with no Notification API is unsupported and is asked nothing; otherwise the
 *   platform's own answer passes through, falling back to the live permission when the
 *   request answers with neither.
 * - Turning the preference on stores the opt-in only when the request came back granted,
 *   judged by the request's answer rather than the permission it started from; a denial, a
 *   dismissed prompt and a missing API all leave it off.
 * - The hint under the switch is silent until something needs saying, names a dismissed
 *   prompt, and keeps a refusal or a missing API on screen.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ENABLED_NOTIFICATION_TAG,
  NOTIFICATIONS_KEY,
  enableNotifications,
  notificationHintFor,
  notificationPermission,
  notificationsEnabledVersion,
  readNotificationsEnabled,
  requestNotificationPermission,
  subscribeNotificationsEnabled,
  writeNotificationsEnabled,
} from "../src/lib/notification-pref";
import { blockedStorage, memoryStorage } from "./helpers/storage";

interface RecordedNotice {
  title: string;
  options: NotificationOptions | undefined;
}

/**
 * A platform whose permission answer is fixed. `requestPermission` records its calls so a
 * test can tell an answer that came from the platform apart from one assumed by the app, and
 * constructing `new Notification(...)` records the confirmation notice.
 */
function stubNotification(permission: NotificationPermission): {
  requests: number;
  notices: RecordedNotice[];
} {
  const calls = { requests: 0, notices: [] as RecordedNotice[] };
  class FakeNotification {
    static permission = permission;
    static async requestPermission(): Promise<NotificationPermission> {
      calls.requests += 1;
      return permission;
    }
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      calls.notices.push({ title, options });
    }
    close(): void {}
  }
  vi.stubGlobal("Notification", FakeNotification);
  return calls;
}

describe("the stored opt-in", () => {
  it("is off unless the stored value is exactly the on marker", () => {
    expect(readNotificationsEnabled(memoryStorage())).toBe(false);
    expect(readNotificationsEnabled(memoryStorage({ [NOTIFICATIONS_KEY]: "1" }))).toBe(true);
    expect(readNotificationsEnabled(memoryStorage({ [NOTIFICATIONS_KEY]: "0" }))).toBe(false);
    expect(readNotificationsEnabled(memoryStorage({ [NOTIFICATIONS_KEY]: "true" }))).toBe(false);
  });

  it("round-trips a write and tells its subscribers", () => {
    const storage = memoryStorage();
    let notified = 0;
    const stop = subscribeNotificationsEnabled(() => {
      notified += 1;
    });
    const before = notificationsEnabledVersion();

    writeNotificationsEnabled(true, storage);
    expect(readNotificationsEnabled(storage)).toBe(true);
    writeNotificationsEnabled(false, storage);
    expect(readNotificationsEnabled(storage)).toBe(false);

    expect(notified).toBe(2);
    expect(notificationsEnabledVersion()).toBe(before + 2);
    stop();
    writeNotificationsEnabled(true, storage);
    expect(notified).toBe(2);
  });

  it("survives storage that throws, which only costs persistence", () => {
    const broken = blockedStorage();
    expect(readNotificationsEnabled(broken)).toBe(false);
    expect(() => writeNotificationsEnabled(true, broken)).not.toThrow();
  });
});

describe("asking the platform for permission", () => {
  it("reports a platform with no Notification API as unsupported, and asks it nothing", async () => {
    vi.stubGlobal("Notification", undefined);
    expect(notificationPermission()).toBe("unsupported");
    await expect(requestNotificationPermission()).resolves.toBe("unsupported");
  });

  it("passes the platform's own answer through", async () => {
    stubNotification("default");
    expect(notificationPermission()).toBe("default");
    await expect(requestNotificationPermission()).resolves.toBe("default");

    stubNotification("granted");
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });

  it("falls back to the live permission when the request answers with neither", async () => {
    // The older callback-style API resolves undefined while still setting the permission.
    vi.stubGlobal("Notification", {
      permission: "granted",
      requestPermission: async () => undefined,
    });
    await expect(requestNotificationPermission()).resolves.toBe("granted");
  });
});

describe("turning the preference on", () => {
  it("stores the opt-in and shows a confirmation notice once the request came back granted", async () => {
    const storage = memoryStorage();
    const calls = stubNotification("granted");

    await expect(enableNotifications(storage)).resolves.toBe("granted");
    expect(calls.requests).toBe(1);
    expect(readNotificationsEnabled(storage)).toBe(true);
    expect(calls.notices).toHaveLength(1);
    expect(calls.notices[0]?.options?.tag).toBe(ENABLED_NOTIFICATION_TAG);
  });

  it.each(["denied", "default", "unsupported"] as const)(
    "does not latch on or show a notice when the answer is %s (a refusal, a dismissed prompt, no API at all)",
    async (answer) => {
      const storage = memoryStorage();
      const calls = answer === "unsupported" ? null : stubNotification(answer);
      if (answer === "unsupported") vi.stubGlobal("Notification", undefined);

      await expect(enableNotifications(storage)).resolves.toBe(answer);
      expect(readNotificationsEnabled(storage)).toBe(false);
      expect(storage.map.has(NOTIFICATIONS_KEY)).toBe(false);
      expect(calls?.notices ?? []).toEqual([]);
    },
  );

  it("takes the answer the request gave, not the permission it started from", async () => {
    // The real sequence, which a stub answering with a fixed permission cannot express:
    // the permission is "default" until the prompt is answered, and only the request
    // reports what the user chose.
    const storage = memoryStorage();
    let permission: NotificationPermission = "default";
    vi.stubGlobal("Notification", {
      get permission() {
        return permission;
      },
      requestPermission: async () => {
        permission = "granted";
        return permission;
      },
    });

    await expect(enableNotifications(storage)).resolves.toBe("granted");
    expect(readNotificationsEnabled(storage)).toBe(true);
  });
});

describe("what the row says under the switch", () => {
  it("says nothing to a platform that has simply not been asked yet", () => {
    expect(notificationHintFor("default", false)).toBeNull();
    expect(notificationHintFor("granted", false)).toBeNull();
    expect(notificationHintFor("granted", true)).toBeNull();
  });

  it("names a prompt closed without an answer, which is the switch springing back", () => {
    // A dismissal leaves the permission at "default", so nothing is stored and the switch
    // reverts. With no line under it that click reads as a control that does nothing.
    expect(notificationHintFor("default", true)).toBe("dismissed");
  });

  it("keeps a refusal and a missing API on screen whether or not this session asked", () => {
    expect(notificationHintFor("denied", false)).toBe("denied");
    expect(notificationHintFor("denied", true)).toBe("denied");
    expect(notificationHintFor("unsupported", false)).toBe("unsupported");
    expect(notificationHintFor("unsupported", true)).toBe("unsupported");
  });
});
