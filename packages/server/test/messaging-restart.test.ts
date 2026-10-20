/**
 * A messaging bot bound to a conversation that has not run yet keeps answering on that
 * conversation after the server restarts.
 *
 * Such a Session has no Trace, so the restarted server cannot resume it and rebuilds it from its
 * index row on the first message. The binding is keyed by the Session's id, so the rebuild has to
 * keep that id: under a new one the poller would keep receiving while every reply went to a
 * channel nobody relays, and the binding would point at a Session that no longer exists.
 *
 * The Session is a real core Session talking to the suite's loopback model endpoint; Telegram is
 * the real Bot API transport over the suite's fetch fake, one Bot API for both processes.
 *
 * - Given a Session that never ran, with its Telegram bot enabled, when the server restarts and a
 *   message arrives at the bot, the Task runs on that same Session, its reply goes out through
 *   the bot to the chat that wrote, and the binding still names the Session.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type {
  MessagesResponse,
  MessagingBindingsResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import type {
  TelegramTransportOpts,
  TelegramUpdate,
} from "../src/runtime/messaging/telegram-api.js";
import { createTelegramTransport } from "../src/runtime/messaging/telegram-api.js";
import { fakeFetch, jsonResponse } from "./fixtures/fetch.js";
import type { FetchCall } from "./fixtures/fetch.js";
import { apiClient, createTestApp, loginAdmin, restartTestApp, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";
import { MOCK_MODEL_ID, startMockLLM, userTexts } from "./live-session.js";
import type { MockLLM } from "./live-session.js";

const PROJECT = "default_project";
const BOT_ID = 7000000077;
const BOT_TOKEN = `${BOT_ID}:restart-secret-CCCC-3333`;
const CHAT_ID = 5151;
const REPLY = "Answered after the restart";

/**
 * Telegram's Bot API: `getMe`, `getWebhookInfo` (none set), a `getUpdates` that drains to
 * nothing and then parks until an update is queued or the poll is aborted, and `sendMessage`,
 * recorded.
 */
function fakeBotApi() {
  const queue: TelegramUpdate[] = [];
  const sent: Array<{ chatId: unknown; text: string }> = [];
  const waiting = new Set<() => void>();

  const parked = (signal: AbortSignal | null | undefined) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason as Error);
      const wake = () => {
        waiting.delete(wake);
        signal?.removeEventListener("abort", abort);
        resolve();
      };
      const abort = () => {
        waiting.delete(wake);
        reject(signal!.reason as Error);
      };
      waiting.add(wake);
      signal?.addEventListener("abort", abort, { once: true });
    });

  const answer = async (call: FetchCall) => {
    const method = new URL(call.url).pathname.split("/").at(-1);
    const body = (call.body === "" ? {} : JSON.parse(call.body)) as Record<string, unknown>;
    const ok = (result: unknown) => jsonResponse({ ok: true, result });
    switch (method) {
      case "getMe":
        return ok({ id: BOT_ID, is_bot: true, first_name: "Restart bot", username: "restart_bot" });
      case "getWebhookInfo":
        return ok({ url: "" });
      case "getUpdates": {
        // The backlog drain each connection starts with: nothing was waiting.
        if (body.offset === -1) return ok([]);
        const from = typeof body.offset === "number" ? body.offset : 0;
        const pending = () => queue.filter((u) => u.update_id >= from);
        if (pending().length === 0 && Number(body.timeout) > 0) await parked(call.init?.signal);
        return ok(pending());
      }
      case "sendMessage":
        sent.push({ chatId: body.chat_id, text: String(body.text) });
        return ok({ message_id: 900 + sent.length });
      default:
        return jsonResponse({ ok: false, error_code: 404, description: "Not Found" }, 404);
    }
  };

  const fetch = fakeFetch(answer);
  return {
    transport: createTelegramTransport({
      fetch: fetch.fetch as unknown as TelegramTransportOpts["fetch"],
    }),
    sent,
    /** A user's message arrives at the bot. */
    push(update: TelegramUpdate) {
      queue.push(update);
      for (const wake of [...waiting]) wake();
    },
  };
}

/** The main-session assistant texts among `messages`. */
function assistantTexts(messages: readonly OmniMessage[]): string[] {
  return messages.flatMap((m) => {
    const p = m.payload as { type?: string; role?: string; text?: string };
    return m.type === "model_msg" &&
      !m.origin?.length &&
      p.type === "text" &&
      p.role === "assistant"
      ? [p.text ?? ""]
      : [];
  });
}

describe("a bot bound to a Session that never ran, across a server restart", () => {
  let t: TestApp;
  let mock: MockLLM;
  let bot: ReturnType<typeof fakeBotApi>;
  let sessionId: string;

  beforeAll(async () => {
    mock = await startMockLLM(() => REPLY);
    bot = fakeBotApi();
    // Titles stay off, so the model is asked for the Task alone.
    const options = {
      telegramTransport: bot.transport,
      telegramRetryDelayMs: () => 1,
      titles: { maybeGenerate: () => {} },
    };
    t = await createTestApp({ ...options, durableDatabase: true });
    const api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const models = await api.put(`/api/projects/${PROJECT}/models`, {
      defaultModel: { provider: "custom", modelId: MOCK_MODEL_ID },
      models: [
        {
          provider: "custom",
          modelId: MOCK_MODEL_ID,
          apiKey: "sk-mock",
          baseUrl: mock.url,
          contextWindow: 200_000,
        },
      ],
    });
    expect(models.status, await models.text()).toBe(200);
    const created = await api.post(`/api/projects/${PROJECT}/agents/default_agent/sessions`, {});
    expect(created.status).toBe(201);
    sessionId = ((await created.json()) as SessionCreateResponse).session.sessionId;
    const base = `/api/sessions/${sessionId}/messaging/telegram`;
    expect((await api.put(base, { botToken: BOT_TOKEN })).status).toBe(200);
    expect((await api.post(`${base}/state`, { enabled: true })).status).toBe(200);
    await waitFor(() => t.deps.messaging.statusOf(sessionId, "telegram").state === "connected");

    t = await restartTestApp(t, options);
    await waitFor(() => t.deps.messaging.statusOf(sessionId, "telegram").state === "connected");
  });
  afterAll(async () => {
    await t?.deps.manager.shutdown();
    await t?.cleanup();
    await mock?.close();
  });

  it("answers the first message on the same Session, and the binding still names it", async () => {
    bot.push({
      update_id: 801,
      message: { message_id: 21, chat: { id: CHAT_ID, type: "private" }, text: "Still there?" },
    });

    await waitFor(() => bot.sent.some((s) => s.text.includes(REPLY)), 15_000);
    expect(bot.sent.find((s) => s.text.includes(REPLY))?.chatId).toBe(CHAT_ID);
    expect(mock.requests).toHaveLength(1);

    const api = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const history = await api.get(`/api/sessions/${sessionId}/messages`);
    expect(history.status).toBe(200);
    const { messages } = (await history.json()) as MessagesResponse;
    expect(userTexts(messages)).toEqual([{ sender: "user", text: "Still there?" }]);
    expect(assistantTexts(messages)).toEqual([REPLY]);

    const bindings = await api.get(`/api/sessions/${sessionId}/messaging`);
    expect(bindings.status).toBe(200);
    const { bindings: rows } = (await bindings.json()) as MessagingBindingsResponse;
    expect(rows.map((b) => [b.binding.channel, b.binding.enabled, b.status.state])).toEqual([
      ["telegram", true, "connected"],
    ]);
  });
});
