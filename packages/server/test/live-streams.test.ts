/**
 * Ending the streams a revoked session left open.
 *
 * Three layers, in the order the fix works: the registry that knows which streams belong
 * to which user, the non-renewing session check a long-lived connection re-asks with, and
 * the SSE heartbeat that puts the two together — the catch-all for anything that drops
 * session rows without telling the registry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { LiveStreamRegistry } from "../src/auth/live-streams.js";
import { SESSION_COOKIE } from "../src/auth/middleware.js";
import { sessionTokenHash } from "../src/db/repos/auth-sessions.js";
import { Channel } from "../src/runtime/channel.js";
import { sseEndpoint } from "../src/http/sse.js";
import { createTestApp, loginAdmin } from "./helpers.js";

const DAY_MS = 24 * 60 * 60 * 1000;
/** The heartbeat period the SSE endpoint runs on (http/sse.ts). */
const HEARTBEAT_MS = 20_000;

describe("live stream registry", () => {
  it("holds a user's streams and ends them all at once", () => {
    const registry = new LiveStreamRegistry();
    const ended: string[] = [];
    registry.add("alice", () => ended.push("alice-1"));
    registry.add("alice", () => ended.push("alice-2"));

    expect(registry.countFor("alice")).toBe(2);
    expect(registry.endForUser("alice")).toBe(2);
    expect(ended).toEqual(["alice-1", "alice-2"]);
  });

  it("leaves another user's streams alone", () => {
    const registry = new LiveStreamRegistry();
    let bobEnded = false;
    registry.add("alice", () => undefined);
    registry.add("bob", () => {
      bobEnded = true;
    });

    registry.endForUser("alice");
    expect(bobEnded).toBe(false);
    expect(registry.countFor("bob")).toBe(1);
  });

  it("a released stream is no longer ended, and releasing twice is harmless", () => {
    const registry = new LiveStreamRegistry();
    let ended = 0;
    const release = registry.add("alice", () => {
      ended += 1;
    });

    release();
    release();
    expect(registry.countFor("alice")).toBe(0);
    expect(registry.endForUser("alice")).toBe(0);
    expect(ended).toBe(0);
  });

  it("a stream that releases itself while the registry is ending it is still counted once", () => {
    const registry = new LiveStreamRegistry();
    let ended = 0;
    // What the SSE endpoint does: the call that ends the connection leads to the release.
    const release: () => void = registry.add("alice", () => {
      ended += 1;
      release();
    });

    expect(registry.endForUser("alice")).toBe(1);
    expect(ended).toBe(1);
    expect(registry.countFor("alice")).toBe(0);
  });

  it("a user nobody is streaming for is a no-op", () => {
    const registry = new LiveStreamRegistry();
    expect(registry.endForUser("nobody")).toBe(0);
    expect(registry.countFor("nobody")).toBe(0);
  });
});

describe("sessionIsLive", () => {
  it("answers for the row behind the token without sliding its expiry", async () => {
    let now = new Date("2026-09-21T00:00:00.000Z");
    // A session minted 30 days long renews once less than 29 days of it are left, so two
    // days on the clock is enough for the renewing path to be visibly different.
    const t = await createTestApp({
      now: () => now,
      config: { authSessionTtlMs: 30 * DAY_MS, authSessionRenewMs: 29 * DAY_MS },
    });
    try {
      const { cookie } = await loginAdmin(t.app);
      const token = cookie.slice(`${SESSION_COOKIE}=`.length);
      const hash = sessionTokenHash(token);
      const expiresAt = (): unknown => {
        const sql = "SELECT expires_at FROM auth_sessions WHERE token_hash = ?";
        const row = t.deps.db.prepare(sql).get(hash) as { expires_at: unknown };
        return row.expires_at;
      };

      now = new Date(now.getTime() + 2 * DAY_MS);
      const before = expiresAt();
      expect(t.deps.authService.sessionIsLive(token)).toBe(true);
      expect(expiresAt()).toBe(before);

      // The contrast: the path the request gate uses tops the expiry up in place, which is
      // exactly what a connection re-checking itself every 20s must not do.
      expect(t.deps.authService.authenticateWithMeta(token)).not.toBeNull();
      expect(expiresAt()).not.toBe(before);
    } finally {
      await t.cleanup();
    }
  });

  it("is false once the row is gone, and false while it is only expired", async () => {
    let now = new Date("2026-09-21T00:00:00.000Z");
    const t = await createTestApp({ now: () => now });
    try {
      const { cookie } = await loginAdmin(t.app);
      const token = cookie.slice(`${SESSION_COOKIE}=`.length);
      expect(t.deps.authService.sessionIsLive(token)).toBe(true);

      // Expired but still on disk: the sweep has not run, and the check must not be fooled
      // by the row merely existing.
      now = new Date(now.getTime() + 31 * DAY_MS);
      expect(t.deps.authService.sessionIsLive(token)).toBe(false);

      t.deps.db.prepare("DELETE FROM auth_sessions").run();
      expect(t.deps.authService.sessionIsLive(token)).toBe(false);
      expect(t.deps.authService.sessionIsLive("never-issued")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });
});

describe("the SSE heartbeat re-checks its own session", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** An SSE route over a bare channel; `live` stands in for the session row behind the connection. */
  function streamingApp(session: { live: boolean }, registry: LiveStreamRegistry) {
    const app = new Hono();
    app.get("/stream", (c) =>
      sseEndpoint(c, new Channel(), {
        initialEvents: [{ type: "hello" }],
        revocation: {
          userId: "alice",
          streams: registry,
          sessionIsLive: () => session.live,
        },
      }),
    );
    return app;
  }

  it("a session that is still there gets a ping and keeps the stream", async () => {
    // Only the interval: the stream's own plumbing runs on promises, and faking those
    // would stall the reads below.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const registry = new LiveStreamRegistry();
    const session = { live: true };
    const res = await streamingApp(session, registry).request("/stream");
    const reader = res.body!.getReader();
    await reader.read(); // hello: the connection is established and registered

    vi.advanceTimersByTime(HEARTBEAT_MS);
    const beat = await reader.read();
    expect(beat.done).toBe(false);
    expect(new TextDecoder().decode(beat.value)).toContain(": ping");
    expect(registry.countFor("alice")).toBe(1);
    await reader.cancel();
  });

  it("a session that was revoked ends the stream on the next beat, and releases it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const registry = new LiveStreamRegistry();
    const session = { live: true };
    const res = await streamingApp(session, registry).request("/stream");
    const reader = res.body!.getReader();
    await reader.read();
    expect(registry.countFor("alice")).toBe(1);

    // Whatever dropped the rows did not tell the registry — the beat is what notices.
    session.live = false;
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect((await reader.read()).done).toBe(true);
    expect(registry.countFor("alice")).toBe(0);
  });
});
