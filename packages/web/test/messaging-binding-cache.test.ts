/**
 * What a machine conversation's messaging binding last looked like, kept in this browser
 * (features/messaging/messaging-binding-cache.ts).
 *
 * - A read answer is remembered per Project, machine and Session, and comes back with its time;
 *   the next answer replaces it.
 * - An answer with nothing saved forgets the entry.
 * - A storage that refuses is not an error: nothing is remembered, nothing comes back.
 * - An entry that no longer has the editor's shape reads as nothing remembered.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { MessagingBindingsResponse } from "@prismshadow/penguin-server/api";
import { cachedBinding, rememberBinding } from "../src/features/messaging/messaging-binding-cache";
import { blockedStorage, stubLocalStorage, type MemoryStorage } from "./helpers/storage";

const answer = (enabled: boolean): MessagingBindingsResponse => ({
  bindings: [
    {
      binding: {
        channel: "telegram",
        sessionId: "s1",
        botId: "123456",
        botTokenMasked: "1234…FAKE",
        enabled,
        linePerMessage: false,
        finalReplyOnly: false,
        renderMarkdown: true,
        lastChatKnown: true,
        createdAt: "2026-10-19T08:00:00.000Z",
        updatedAt: "2026-10-19T08:00:00.000Z",
      },
      status: { state: enabled ? "connected" : "disconnected" },
    },
  ],
});

describe("messaging binding cache", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = stubLocalStorage();
  });

  it("remembers an answer per Session with its time, and the next answer replaces it", () => {
    rememberBinding("p", "M1", "s1", answer(false), "2026-10-19T09:00:00.000Z");
    rememberBinding("p", "M1", "s2", answer(true), "2026-10-19T09:01:00.000Z");
    rememberBinding("p", "M1", "s1", answer(true), "2026-10-19T09:02:00.000Z");
    expect(cachedBinding("p", "M1", "s1")).toEqual({
      at: "2026-10-19T09:02:00.000Z",
      res: answer(true),
    });
    expect(cachedBinding("p", "M1", "s2")?.at).toBe("2026-10-19T09:01:00.000Z");
    expect(cachedBinding("p", "M2", "s1")).toBeNull();
    expect(cachedBinding("other", "M1", "s1")).toBeNull();
  });

  it("forgets the entry when an answer has nothing saved", () => {
    rememberBinding("p", "M1", "s1", answer(true));
    rememberBinding("p", "M1", "s1", { bindings: [] });
    expect(cachedBinding("p", "M1", "s1")).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("neither throws nor remembers when the browser refuses storage", () => {
    stubLocalStorage(blockedStorage());
    expect(() => rememberBinding("p", "M1", "s1", answer(true))).not.toThrow();
    expect(cachedBinding("p", "M1", "s1")).toBeNull();
  });

  it("reads an entry that no longer has the editor's shape as nothing remembered", () => {
    rememberBinding("p", "M1", "s1", answer(true));
    const [key] = [...storage.map.keys()];
    for (const junk of [
      "{not json",
      JSON.stringify({ at: 7, res: answer(true) }),
      JSON.stringify({ at: "2026-10-19T09:00:00.000Z", res: { bindings: [{ binding: {} }] } }),
      JSON.stringify(["2026-10-19T09:00:00.000Z"]),
    ]) {
      storage.setItem(key!, junk);
      expect(cachedBinding("p", "M1", "s1")).toBeNull();
    }
  });
});
