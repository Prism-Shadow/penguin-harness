/**
 * The machine leg beats before it has planned anything (http/routes/history-lines.ts): a large
 * Session's plan takes a while, and the hub ends a machine stream it has not heard from in
 * fifteen seconds.
 *
 * - Given a plan still reading the Session, the stream has begun and a `ping` arrives every beat;
 *   once the plan is done, the window follows.
 *
 * The trace service is the boundary faked here: a read that answers only when the test lets it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../src/auth/middleware.js";
import type { SessionRow } from "../src/db/repos/sessions.js";
import { historyLinesRoutes } from "../src/http/routes/history-lines.js";
import type { HistoryLinesRouteDeps } from "../src/http/routes/history-lines.js";
import { HISTORY_LINES_BEAT_MS } from "../src/services/history-lines.js";
import { initialScanState } from "../src/services/message-window.js";
import type { HistoryWindowRead } from "../src/services/trace-service.js";
import { sessionRow } from "./fixtures/session.js";

describe("history-lines while it plans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("beats from the start, and the window follows the plan", async () => {
    let release: (read: HistoryWindowRead) => void = () => undefined;
    const row: SessionRow = sessionRow("s1", { projectId: "p", agentId: "a" });
    const deps: HistoryLinesRouteDeps = {
      traces: {
        readHistoryWindow: () => new Promise((resolve) => (release = resolve)),
        historyTraceFiles: async () => [],
      },
      sessions: { findById: (id) => (id === "s1" ? row : null) },
      access: { requireProjectAccess: () => ({}) as never },
      manager: {
        statusOf: () => "idle",
        liveFragments: () => [],
        pendingInputs: () => [],
        pendingBootstrap: () => [],
      },
      channels: { get: () => ({ lastEventId: "" }) as never },
    };
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("user", { userId: "u" } as never);
      await next();
    });
    app.route("/api/sessions", historyLinesRoutes(deps));
    const res = await app.request("/api/sessions/s1/history-lines?tailLimit=1");
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      while (!text.includes(needle)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
    };
    await vi.advanceTimersByTimeAsync(HISTORY_LINES_BEAT_MS);
    await readUntil("event: ping");
    expect(text).not.toContain("event: window");
    await vi.advanceTimersByTimeAsync(HISTORY_LINES_BEAT_MS);
    release({ messages: [], sources: [], page: { prior: initialScanState().totals, units: 0 } });
    await readUntil("event: done");
    expect(text.match(/event: ping/g)?.length).toBeGreaterThanOrEqual(2);
    expect(text.indexOf("event: window")).toBeGreaterThan(text.lastIndexOf("event: ping"));
  });
});
