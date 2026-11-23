/**
 * A plugin install read as it arrives (`installPluginStream`, api/endpoints.ts): the server's
 * `text/event-stream` answer, cut into chunks the way a network cuts it.
 *
 * - Given each event arrives in a chunk of its own — `npm` first, then two `download` events and
 *   the `result` — the install answers the result, and the progress listener hears both
 *   downloads in order. (The reader once never looked for the next event's end after taking
 *   one, and spun forever on the first: the page froze.)
 * - Given two events arrive in one chunk, both are read: the result is answered whole.
 * - Given an event, and a character inside it, are split across chunks, it is read once whole.
 * - Given a comment and a `ping` sit between the events, they are passed over.
 * - Given the server sends an `error` event, the install raises it with its status and code.
 * - Given the stream ends before a result, the install fails as a lost connection.
 */
import { describe, expect, it } from "vitest";
import type { InstalledPluginsResponse } from "@prismshadow/penguin-server/api";
import { ApiError } from "../src/api/client";
import * as api from "../src/api/endpoints";
import { stubFetch } from "./helpers/fetch";

const RESULT: InstalledPluginsResponse = {
  plugins: [
    {
      specifier: "@acme/notes",
      active: true,
      builtin: false,
      modules: ["Notes"],
      replaces: [],
      everywhere: false,
      machines: ["m1"],
      here: true,
    },
  ],
  shipped: [],
  file: ".project_config.toml",
  machineId: "m1",
  restartPending: false,
};

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** Answers the install with an event stream that delivers `chunks` one read at a time. */
function serverSends(chunks: readonly (string | Uint8Array)[]) {
  const fetch = stubFetch(() => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
        }
        controller.close();
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  return fetch;
}

async function install(): Promise<{
  answer: Promise<InstalledPluginsResponse>;
  progress: Array<[number, number | null]>;
}> {
  const progress: Array<[number, number | null]> = [];
  const answer = api.installPluginStream("p1", "@acme/notes", "m1", (received, total) =>
    progress.push([received, total]),
  );
  return { answer, progress };
}

describe("installPluginStream", () => {
  it("reads every event when each arrives in a chunk of its own", async () => {
    const fetch = serverSends([
      event("npm", {}),
      event("download", { received: 10, total: 40 }),
      event("download", { received: 40, total: 40 }),
      event("result", RESULT),
    ]);
    const { answer, progress } = await install();
    await expect(answer).resolves.toEqual(RESULT);
    expect(progress).toEqual([
      [10, 40],
      [40, 40],
    ]);
    expect(fetch.requests.map((r) => [r.method, r.path, r.body])).toEqual([
      ["POST", "/api/projects/p1/plugins/installed", { specifier: "@acme/notes", machineId: "m1" }],
    ]);
  });

  it("reads both events when two arrive in one chunk", async () => {
    serverSends([event("npm", {}) + event("result", RESULT)]);
    const { answer } = await install();
    await expect(answer).resolves.toEqual(RESULT);
  });

  it("reads an event split across chunks once, whole, even mid-character", async () => {
    const withName: InstalledPluginsResponse = { ...RESULT, file: "插件.toml" };
    const bytes = new TextEncoder().encode(event("npm", {}) + event("result", withName));
    // Split inside the npm event's data, and again inside the first byte sequence of 插.
    const inChar = bytes.indexOf(0xe6) + 1;
    serverSends([bytes.slice(0, 15), bytes.slice(15, inChar), bytes.slice(inChar)]);
    const { answer } = await install();
    await expect(answer).resolves.toEqual(withName);
  });

  it("passes over comments and pings between events", async () => {
    serverSends([event("npm", {}), ": keep-alive\n\n", event("ping", {}), event("result", RESULT)]);
    const { answer } = await install();
    await expect(answer).resolves.toEqual(RESULT);
  });

  it("raises an error event with its status and code", async () => {
    serverSends([
      event("npm", {}),
      event("error", { status: 400, code: "plugin_install_failed", message: "not on npm" }),
    ]);
    const { answer } = await install();
    const failure = await answer.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 400, code: "plugin_install_failed" });
  });

  it("fails as a lost connection when the stream ends before a result", async () => {
    serverSends([event("npm", {})]);
    const { answer } = await install();
    await expect(answer).rejects.toMatchObject({ code: "network_error" });
  });
});
