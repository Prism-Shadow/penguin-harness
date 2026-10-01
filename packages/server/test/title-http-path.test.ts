/**
 * Title generation over the HTTP path the Web App uses — create the Session, then start its
 * first Task — against the real wiring (SessionManager, TitleGenerator, ChannelHub, DB); only
 * the runtime Session is faked, with its run and its title request gated.
 *
 * - A new Session's stored title is NULL ("New chat" is the client's display fallback).
 * - The first Task's input is persisted as the fallback title and pushed on the Session's
 *   channel and on the user channel before any model output.
 * - The model's title then replaces it, pushed on both channels too.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RuntimeSession } from "../src/runtime/session-manager.js";
import type { ChannelEvent } from "../src/runtime/channel.js";
import { userChannelKey } from "../src/http/routes/events.js";
import { fakeSession } from "./fixtures/session.js";
import { apiClient, createTestApp, provisionUser, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** Fake runtime Session: the run parks until released, generateTitle parks until released. */
function gatedSession(
  sessionId: string,
  runGate: Promise<void>,
  titleGate: Promise<void>,
): RuntimeSession {
  return fakeSession(sessionId, {
    generateTitle: async () => {
      await titleGate;
      return { title: "Login page bug", usage: null };
    },
    async *run() {
      await runGate;
    },
  });
}

describe("title generation over the web's HTTP path", () => {
  let t: TestApp;
  let api: ReturnType<typeof apiClient>;
  let releaseRun!: () => void;
  let releaseTitle!: () => void;

  beforeEach(async () => {
    t = await createTestApp();
    const { cookie } = await provisionUser(t.app, "titler");
    api = apiClient(t.app, cookie);
    // The draft flow creates the Session with no model reference, so the Project must carry
    // a default one. Seed it explicitly rather than relying on what the first-run seed
    // detects: that comes from ambient provider credentials, which a dev box has and CI
    // does not, and without a default createSession answers 400.
    await api.put("/api/projects/titler-default_project/models", {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
  });

  afterEach(async () => {
    releaseRun?.();
    releaseTitle?.();
    await t.cleanup();
  });

  it("writes the user-input fallback before any model output, pushes session_title, then the LLM result replaces it", async () => {
    // 1. Create the Session exactly like the Web draft flow does.
    const created = await api.post(
      "/api/projects/titler-default_project/agents/default_agent/sessions",
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as {
      session: { sessionId: string; title?: string | null };
    };
    const sid = session.sessionId;
    // The stored title of a fresh Session is NULL — "New chat" is purely a display fallback.
    expect(t.deps.sessionsRepo.findById(sid)!.title).toBeNull();

    // Swap in the gated fake runtime for the first Task.
    const runGate = new Promise<void>((r) => (releaseRun = r));
    const titleGate = new Promise<void>((r) => (releaseTitle = r));
    t.deps.manager.adopt(t.deps.sessionsRepo.findById(sid)!, gatedSession(sid, runGate, titleGate));

    // Subscribe to the session's channel the way the SSE endpoint does — and to the
    // user-level channel, which the real app holds open from startup. The user channel is
    // the delivery the session list depends on: at first-Task time no tab has subscribed
    // to the brand-new session's own channel yet.
    const events: ChannelEvent[] = [];
    t.deps.channels.get(sid).subscribe((e) => events.push(e));
    const userEvents: ChannelEvent[] = [];
    t.deps.channels.get(userChannelKey("titler")).subscribe((e) => userEvents.push(e));

    // 2. First message, same body shape the Web composer sends.
    const res = await api.post(`/api/sessions/${sid}/tasks`, {
      input: [{ type: "text", text: "Fix the login page rendering bug please" }],
    });
    expect(res.status).toBe(202);

    // 3. The fallback is persisted and pushed while the run is still parked (the fake
    //    has produced no output, and the LLM gate is still closed).
    await waitFor(() => t.deps.sessionsRepo.findById(sid)!.title !== null);
    expect(t.deps.sessionsRepo.findById(sid)!.title).toBe("Fix the login page rendering");
    const titlesOf = (list: ChannelEvent[]) => () =>
      list
        .filter((e) => e.event === "server_event")
        .map((e) => JSON.parse(e.data) as { type: string; title?: string })
        .filter((e) => e.type === "session_title")
        .map((e) => e.title);
    const titles = titlesOf(events);
    const userTitles = titlesOf(userEvents);
    await waitFor(() => titles().includes("Fix the login page rendering"));
    await waitFor(() => userTitles().includes("Fix the login page rendering"));

    // 4. The LLM result replaces the fallback and is pushed on both channels as well.
    releaseTitle();
    await waitFor(() => t.deps.sessionsRepo.findById(sid)!.title === "Login page bug");
    await waitFor(() => titles().includes("Login page bug"));
    await waitFor(() => userTitles().includes("Login page bug"));

    releaseRun();
    await waitFor(() => t.deps.manager.statusOf(sid) === "idle");
  });
});
