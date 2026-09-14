/**
 * The task-completion notification's opt-in (lib/notification-pref): what the stored
 * preference reads as, and what a request for OS permission does to it.
 *
 * The defect this covers is that the preference and the permission are separate facts.
 * Nothing may store the opt-in unless the platform granted permission in that same
 * request, or the switch latches on over notifications that can never be shown — and the
 * default has to be off, because turning it on is what opens the system prompt.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
import type { NotificationStorage } from "../src/lib/notification-pref";

/** In-memory storage: vitest runs in a Node environment, so there is no localStorage. */
function fakeStorage(entries: Record<string, string> = {}): NotificationStorage & {
  map: Map<string, string>;
} {
  const map = new Map(Object.entries(entries));
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

/**
 * A platform whose permission answer is fixed. `requestPermission` records its calls so a
 * test can tell an answer that came from the platform apart from one assumed by the app.
 */
function stubNotification(permission: NotificationPermission): { requests: number } {
  const calls = { requests: 0 };
  vi.stubGlobal("Notification", {
    permission,
    requestPermission: async () => {
      calls.requests += 1;
      return permission;
    },
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("the stored opt-in", () => {
  it("is off unless the stored value is exactly the on marker", () => {
    expect(readNotificationsEnabled(fakeStorage())).toBe(false);
    expect(readNotificationsEnabled(fakeStorage({ [NOTIFICATIONS_KEY]: "1" }))).toBe(true);
    expect(readNotificationsEnabled(fakeStorage({ [NOTIFICATIONS_KEY]: "0" }))).toBe(false);
    expect(readNotificationsEnabled(fakeStorage({ [NOTIFICATIONS_KEY]: "true" }))).toBe(false);
  });

  it("round-trips a write and tells its subscribers", () => {
    const storage = fakeStorage();
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
    const broken: NotificationStorage = {
      getItem: () => {
        throw new Error("site data blocked");
      },
      setItem: () => {
        throw new Error("site data blocked");
      },
    };
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
  it("stores the opt-in once the request came back granted", async () => {
    const storage = fakeStorage();
    const calls = stubNotification("granted");

    await expect(enableNotifications(storage)).resolves.toBe("granted");
    expect(calls.requests).toBe(1);
    expect(readNotificationsEnabled(storage)).toBe(true);
  });

  it("does not latch on when the platform denies", async () => {
    const storage = fakeStorage();
    stubNotification("denied");

    await expect(enableNotifications(storage)).resolves.toBe("denied");
    expect(readNotificationsEnabled(storage)).toBe(false);
    expect(storage.map.has(NOTIFICATIONS_KEY)).toBe(false);
  });

  it("does not latch on when the prompt is dismissed, which leaves the answer at default", async () => {
    const storage = fakeStorage();
    stubNotification("default");

    await expect(enableNotifications(storage)).resolves.toBe("default");
    expect(readNotificationsEnabled(storage)).toBe(false);
  });

  it("does not latch on where the platform has no notifications at all", async () => {
    const storage = fakeStorage();
    vi.stubGlobal("Notification", undefined);

    await expect(enableNotifications(storage)).resolves.toBe("unsupported");
    expect(readNotificationsEnabled(storage)).toBe(false);
  });

  it("takes the answer the request gave, not the permission it started from", async () => {
    // The real sequence, which a stub answering with a fixed permission cannot express:
    // the permission is "default" until the prompt is answered, and only the request
    // reports what the user chose.
    const storage = fakeStorage();
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
