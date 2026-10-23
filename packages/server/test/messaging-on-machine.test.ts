/**
 * Messaging runs on the machine: a Session that lives on a machine keeps its bot binding on that
 * machine, connects from there and answers from there, so the bot keeps working while the server
 * that connects the machine cannot reach it.
 *
 * Two apps: the machine, whose Session is bound to a Telegram bot, and the server that connects
 * it, which holds no connection to it for the whole suite (its proxy has nowhere to forward).
 * Each app reaches Telegram through the real Bot API transport over the suite's one fetch fake:
 * a scripted Bot API with an update queue, a parked long poll and a record of every send. The
 * machine's Session is the suite's Session fake, answering every Task with a fixed reply.
 *
 * - Given the bot enabled on the machine's Session, when a message arrives at the bot, the
 *   machine runs a Task with it and the reply goes out through the machine's transport, while
 *   the other server makes no Bot API call and stores no binding.
 * - Given that, the machine's own read reports the connection, while the other server's read of
 *   the same binding through its proxy answers 503 `not_connected`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assistantText } from "@prismshadow/penguin-core";
import type { OmniMessage } from "@prismshadow/penguin-core";
import type { MessagingBindingsResponse } from "../src/api/types.js";
import type {
  TelegramTransportOpts,
  TelegramUpdate,
} from "../src/runtime/messaging/telegram-api.js";
import { createTelegramTransport } from "../src/runtime/messaging/telegram-api.js";
import { fakeFetch, jsonResponse } from "./fixtures/fetch.js";
import type { FetchCall } from "./fixtures/fetch.js";
import { fakeMachinesNode } from "./fixtures/machines.js";
import { adoptSession, fakeSession, uniqueSessionId } from "./fixtures/session.js";
import { apiClient, createTestApp, loginAdmin, waitFor } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
/** The machine's own id, and the alias the other server knows it by. */
const MACHINE = "QS7J4YVgSovi-Z2c";
const ALIAS = "box";
const BOT_ID = 7000000042;
const BOT_TOKEN = `${BOT_ID}:machine-secret-BBBB-2222`;
const REPLY = "Answered on the machine";

/**
 * Telegram's Bot API as one server reaches it: `getMe`, `getWebhookInfo` (none set), a
 * `getUpdates` that drains to nothing and then parks until an update is queued or the poll is
 * aborted, and `sendMessage`, recorded.
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
        return ok({ id: BOT_ID, is_bot: true, first_name: "Machine bot", username: "machine_bot" });
      case "getWebhookInfo":
        return ok({ url: "" });
      case "getUpdates": {
        // The backlog drain a fresh connection starts with: nothing was waiting.
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
    calls: fetch.calls,
    sent,
    /** A user's message arrives at the bot. */
    push(update: TelegramUpdate) {
      queue.push(update);
      for (const wake of [...waiting]) wake();
    },
  };
}

describe("a machine's Session keeps its bot on the machine", () => {
  let machine: TestApp;
  let adopter: TestApp;
  let machineBot: ReturnType<typeof fakeBotApi>;
  let adopterBot: ReturnType<typeof fakeBotApi>;
  let sessionId: string;
  const runs: string[] = [];

  beforeAll(async () => {
    machineBot = fakeBotApi();
    adopterBot = fakeBotApi();
    machine = await createTestApp({
      telegramTransport: machineBot.transport,
      telegramRetryDelayMs: () => 1,
    });
    adopter = await createTestApp({
      telegramTransport: adopterBot.transport,
      machines: fakeMachinesNode((projectId) =>
        projectId === PROJECT ? [{ machineId: MACHINE, alias: ALIAS, api: null }] : [],
      ),
    });

    sessionId = adoptSession(
      machine.deps,
      fakeSession(uniqueSessionId(), {
        async *run(input: OmniMessage[]) {
          runs.push(JSON.stringify(input.map((m) => m.payload)));
          yield assistantText(REPLY);
        },
      }),
    ).sessionId;
    // Bound and turned on as the other server's proxy would do it: as the machine's admin.
    const api = apiClient(machine.app, (await loginAdmin(machine.app)).cookie);
    const base = `/api/sessions/${sessionId}/messaging/telegram`;
    expect((await api.put(base, { botToken: BOT_TOKEN })).status).toBe(200);
    expect((await api.post(`${base}/state`, { enabled: true })).status).toBe(200);
    await waitFor(
      () => machine.deps.messaging.statusOf(sessionId, "telegram").state === "connected",
    );
  });
  afterAll(async () => {
    machine?.deps.messaging.unbindSession(sessionId);
    await adopter?.cleanup();
    await machine?.cleanup();
  });

  it("answers a message from the machine while the other server holds nothing", async () => {
    machineBot.push({
      update_id: 501,
      message: {
        message_id: 11,
        chat: { id: 4242, type: "private" },
        text: "Are you there?",
      },
    });

    await waitFor(() => machineBot.sent.some((s) => s.text.includes(REPLY)));
    expect(runs.some((r) => r.includes("Are you there?"))).toBe(true);
    expect(machineBot.sent.find((s) => s.text.includes(REPLY))?.chatId).toBe(4242);
    expect(adopterBot.calls).toHaveLength(0);
    expect(adopter.deps.messagingRepo.listAll()).toEqual([]);
  });

  it("reports the connection on the machine, while the other server's read is not connected", async () => {
    const own = await apiClient(machine.app, (await loginAdmin(machine.app)).cookie).get(
      `/api/sessions/${sessionId}/messaging`,
    );
    expect(own.status).toBe(200);
    const body = (await own.json()) as MessagingBindingsResponse;
    expect(
      body.bindings.map((b) => [b.binding.channel, b.binding.enabled, b.status.state]),
    ).toEqual([["telegram", true, "connected"]]);

    const remote = await apiClient(adopter.app, (await loginAdmin(adopter.app)).cookie).get(
      `/server/${MACHINE}/api/sessions/${sessionId}/messaging`,
    );
    expect(remote.status).toBe(503);
    expect(((await remote.json()) as { error: { code: string } }).error.code).toBe("not_connected");
  });
});
